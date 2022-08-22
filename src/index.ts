import { Client, GatewayIntentBits, TextChannel } from 'discord.js'
import * as dotenv from 'dotenv'
import { COMMAND_NAMES, initCommands } from './commands'
import { createClient } from '@supabase/supabase-js'
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
      const { data, error } = await supabase.from('users').upsert({ id: clientId, rate: rate })
      if (!error) {
        console.log(data)
        await interaction.editReply({ content: `Your rate of ${rate} has been successfully recorded.` })
      }
    }
  } else if (interaction.commandName === COMMAND_NAMES.ADD_CHANNEL_FOR_CALCULATION) {
    await interaction.deferReply({ ephemeral: true })
    const channel = interaction.options.getChannel('channel')
    console.log(channel)
    // const clientId = interaction.user.id
    if (channel) {
      const { data, error } = await supabase.from('channels').upsert({ id: channel.id, name: channel.name })
      if (!error) {
        console.log(data)
        await interaction.editReply({ content: `The channel ${channel.name} has been added to tracked channels.` })
      }
    }
  }
})

client.on('voiceStateUpdate', async (oldState, newState) => {
  const IS_MUTED_OR_DEAFENED = oldState.mute !== newState.mute || oldState.deaf !== newState.deaf
  if (!IS_MUTED_OR_DEAFENED) {
    const channels = await supabase.from('channels').select('id')
    if (!channels.error && channels.data) {
      const channelIds = channels.data.map((row) => row.id)
      if (channelIds.includes(newState.channelId)) {
        const channelMembers = newState.channel?.members
        if (channelMembers) {
          const usersInChannel = channelMembers.keys()
          const usersFromDB = await supabase.from('users').select('id, rate')
          let finalRate = 0
          if (usersFromDB.data && !usersFromDB.error) {
            for (const userId of usersInChannel) {
              const foundUser = usersFromDB.data.find((user) => user.id === userId)
              if (foundUser) finalRate += foundUser.rate
            }
            ;(client.channels.cache.get(newState.channel?.id) as TextChannel).send(
              `Current hourly rate for this room is ${finalRate}€.`
            )
          }
        }
      }
    }
  }
})
