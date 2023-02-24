import { Client, GatewayIntentBits, TextChannel, VoiceState } from 'discord.js'
import * as dotenv from 'dotenv'
import { COMMAND_NAMES, initCommands } from './commands'
import { createClient } from '@supabase/supabase-js'
import { isBefore, isWithinInterval } from 'date-fns'
import { generateFinalRate } from './utils'
import express from 'express'
dotenv.config()
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })

client.login(process.env.DISCORD_BOT_TOKEN)
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '')

initCommands()

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`)
})

client.on('error', (error) => {
  console.error(error)
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
  } else if (interaction.commandName === COMMAND_NAMES.LIST_CHANNELS) {
    await interaction.deferReply({ ephemeral: true })
    const { data, error } = await supabase.from('channels').select('name')
    await interaction.editReply({ content: `The currently subscribed channels are: ${data?.map((row) => row.name)}` })
  }
})

client.on('voiceStateUpdate', async (oldState, newState) => {
  const IS_MUTED = oldState.mute !== newState.mute
  const IS_DEAFENED = oldState.deaf !== newState.deaf
  const IS_STREAMING = oldState.streaming !== newState.streaming
  const WORKING_TIME_START = new Date(new Date().setHours(8, 0, 0))
  const WORKING_TIME_END = new Date(new Date().setHours(18, 0, 0))

  if (!isWithinInterval(new Date(), { start: WORKING_TIME_START, end: WORKING_TIME_END })) {
    // If it's not working hours, don't do anything.
    return
  }
  if (IS_MUTED || IS_DEAFENED || IS_STREAMING) {
    // If the user is just turning his mic, sound & streaming on/off, don't do anything
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

          await upsertMessage(state, finalRate)
        }
      }
    }
  }
}

const upsertMessage = async (state: VoiceState, finalRate: number) => {
  if (!state.channelId) {
    console.log('no channel ID provided to clear last bot message')
    return
  }
  const tailMessages = await (client.channels.cache.get(state.channelId) as TextChannel).messages.fetch({
    limit: 10,
  })

  const sortedMessages = tailMessages
    .filter((msg) => !!msg)
    .sort((m1, m2) => (isBefore(m2.editedAt || m2.createdAt, m1.editedAt || m1.createdAt) ? 1 : -1))

  const tailWithoutLast = sortedMessages.last(-(sortedMessages.size - 1))
  tailWithoutLast.forEach((message) => {
    if (message && message.author.bot) {
      // Cleanup extra messages from bot, so that we're not spamming too much
      message.delete()
    }
  })
  const lastMessage = sortedMessages.last()

  if (lastMessage && lastMessage.author.bot) {
    // Edit if the last message is from our bot
    lastMessage.edit(generateFinalRate(finalRate))
  } else {
    // Send the hourly rate message
    const hourlyRateMessage = await (client.channels.cache.get(state.channelId) as TextChannel).send(
      generateFinalRate(finalRate)
    )
  }
}

// Express fake init to keep the service alive
const app = express()
const port = process.env.PORT || 3001

app.listen(port, () => console.log(`Listening on port ${port}!`))

app.get('/', async (req, res) => {
  return res.send('Office manager discord bot should be live')
})
