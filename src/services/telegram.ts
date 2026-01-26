import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { handleMessage, handlePhoto, handleStart } from '../agents/chat-handler.js';

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Error handling
  bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    ctx.reply('Something went wrong. Please try again.').catch(console.error);
  });

  // /start command
  bot.start(async (ctx) => {
    await handleStart(ctx);
  });

  // /status command - show current day progress
  bot.command('status', async (ctx) => {
    await handleMessage(ctx, '/status');
  });

  // /reset command - manually reset (for testing)
  bot.command('reset', async (ctx) => {
    await handleMessage(ctx, '/reset');
  });

  // /progress command - show progress pics or analytics
  bot.command('progress', async (ctx) => {
    await handleMessage(ctx, '/progress');
  });

  // Handle photos (progress pics)
  bot.on(message('photo'), async (ctx) => {
    await handlePhoto(ctx);
  });

  // Handle all text messages
  bot.on(message('text'), async (ctx) => {
    await handleMessage(ctx, ctx.message.text);
  });

  return bot;
}

export async function setupWebhook(bot: Telegraf, webhookUrl: string, secretToken: string): Promise<void> {
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: secretToken
  });
  console.log(`Webhook set to ${webhookUrl}`);
}

// For local development with polling
export async function startPolling(bot: Telegraf): Promise<void> {
  // Delete any existing webhook first
  await bot.telegram.deleteWebhook();
  await bot.launch();
  console.log('Bot started with polling');

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
