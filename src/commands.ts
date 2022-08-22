import { REST, Routes, SlashCommandBuilder } from 'discord.js'

export enum COMMAND_NAMES {
  'ADD_RATE' = 'add-rate',
  'ADD_CHANNEL_FOR_CALCULATION' = 'add-channel-for-calculation',
}

const commands = [
  new SlashCommandBuilder()
    .setName(COMMAND_NAMES.ADD_RATE)
    .setDescription('Let me know what your hourly rate is, so that I can calculate the hourly room rate properly')
    .addNumberOption((opt) => opt.setName('rate').setDescription('Your hourly rate').setRequired(true)),
  new SlashCommandBuilder()
    .setName(COMMAND_NAMES.ADD_CHANNEL_FOR_CALCULATION)
    .setDescription('Add a new room for calculation of the hourly rate')
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('New channel to use for calculation').setRequired(true)
    ),
].map((cmd) => cmd.toJSON())

export const initCommands = async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN || '')

  try {
    console.log('Started refreshing application (/) commands.')

    await rest.put(Routes.applicationCommands(process.env.DISCORD_APP_ID || ''), { body: commands })

    console.log('Successfully reloaded application (/) commands.')
  } catch (error) {
    console.error(error)
  }
}
