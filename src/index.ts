import { Client, GatewayIntentBits, TextChannel, VoiceState } from 'discord.js'
import * as dotenv from 'dotenv'
import { COMMAND_NAMES, initCommands } from './commands'
import { createClient } from '@supabase/supabase-js'
import { isWithinInterval } from 'date-fns'
dotenv.config()
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })

client.login(process.env.DISCORD_BOT_TOKEN)
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '')

initCommands()

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`)
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === COMMAND_NAMES.ADD_RATE) {
    await interaction.deferReply({ ephemeral: true })
    const rate = interaction.options.getNumber('rate')
    const clientId = interaction.user.id
    if (rate && clientId) {
      const { data, error } = await supabase
        .from('users')
        .upsert({ id: clientId, rate: rate, name: interaction.user.username })
      if (!error) {
        await interaction.editReply({ content: `Your rate of ${rate} has been successfully recorded.` })
      }
    }
  } else if (interaction.commandName === COMMAND_NAMES.ADD_CHANNEL_FOR_CALCULATION) {
    await interaction.deferReply({ ephemeral: true })
    const channel = interaction.options.getChannel('channel')
    if (channel) {
      const { data, error } = await supabase.from('channels').upsert({ id: channel.id, name: channel.name })
      if (!error) {
        await interaction.editReply({ content: `The channel ${channel.name} has been added to tracked channels.` })
      }
    }
  }
})

client.on('voiceStateUpdate', async (oldState, newState) => {
  const IS_MUTED_OR_DEAFENED = oldState.mute !== newState.mute || oldState.deaf !== newState.deaf
  const WORKING_TIME_START = new Date(new Date().setHours(8, 0, 0))
  const WORKING_TIME_END = new Date(new Date().setHours(18, 0, 0))
  if (!isWithinInterval(new Date(), { start: WORKING_TIME_START, end: WORKING_TIME_END })) {
    // If it's not working hours, don't do anything.
    return
  }
  if (IS_MUTED_OR_DEAFENED) {
    // If the user is just turning his mic or sound on/off, don't do anything
    return
  }
  // Generate rates for both the previous & the new room
  generateHourlyRate(oldState)
  generateHourlyRate(newState)
})

const generateHourlyRate = async (state: VoiceState) => {
  const channels = await supabase.from('channels').select('id')
  if (!channels.error && channels.data) {
    const channelIds = channels.data.map((row) => row.id)
    if (channelIds.includes(state.channelId)) {
      const channelMembers = state.channel?.members
      if (channelMembers) {
        const usersInChannel = channelMembers.keys()
        const usersFromDB = await supabase.from('users').select('id, rate')
        if (usersFromDB.data && !usersFromDB.error) {
          let finalRate = 0
          // Calculate hourly rate
          for (const userId of usersInChannel) {
            const foundUser = usersFromDB.data.find((user) => user.id === userId)
            if (foundUser) finalRate += foundUser.rate
          }

          await clearLastBotMessage(state.channelId)

          // Send the hourly rate message
          const hourlyRateMessage = await (client.channels.cache.get(state.channel?.id) as TextChannel).send(
            `Current hourly rate for this room is ||${finalRate}||€.`
          )
        }
      }
    }
  }
}

const clearLastBotMessage = async (channelId: string | null) => {
  if (!channelId) {
    console.log('no channel ID provided to clear last bot message')
    return
  }
  // Clear last message in chat if it's from a bot, so that we're not spamming too much
  const tailMessages = await (client.channels.cache.get(channelId) as TextChannel).messages.fetch({
    limit: 1,
  })
  const lastMessage = tailMessages.first()
  if (lastMessage && lastMessage.author.bot) {
    lastMessage.delete()
  }
}
