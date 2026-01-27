import { Telegraf } from 'telegraf';
import * as storage from '../services/storage.js';
import { getQuoteForDay } from '../data/goggins-quotes.js';

export async function checkDayResets(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();

      // Only run at 5am (5:00-5:05)
      if (currentHour !== 5) continue;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      const dayLog = await storage.getDayLog(user.id, user.currentDay);
      if (!dayLog) {
        // No activity logged - ask them to confirm failure
        await askForFailureConfirmation(bot, user, ['No activity logged']);
        continue;
      }

      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, program.dietMode || 'confirm', program.baseCalories || undefined);

      if (!status.complete) {
        // Day incomplete - ask them to confirm (no auto-reset)
        await askForFailureConfirmation(bot, user, status.missing);
      } else {
        await handleDayAdvance(bot, user, program);
      }
    } catch (error) {
      console.error(`Reset check failed for user ${user.telegramId}:`, error);
    }
  }
}

async function askForFailureConfirmation(
  bot: Telegraf,
  user: storage.User,
  missing: string[]
): Promise<void> {
  const missingStr = missing.join(', ');

  // Ask for confirmation instead of auto-resetting
  let message: string;

  if (user.currentDay === 1) {
    message = `5am. Day 1 incomplete.\n\nMissing: ${missingStr}\n\nDid you finish after midnight, or did Day 1 not happen? Tell me.`;
  } else {
    message = `5am. Day ${user.currentDay} incomplete.\n\nMissing: ${missingStr}\n\nDid you get it done after midnight? Or do we need to talk about starting over?`;
  }

  await bot.telegram.sendMessage(user.telegramId, message);
}

async function handleDayAdvance(
  bot: Telegraf,
  user: storage.User,
  program: storage.UserProgram
): Promise<void> {
  const completedDay = user.currentDay;

  await storage.advanceUserDay(user.id);

  const nextDay = completedDay + 1;

  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, nextDay, today);

  // Get quote for the day
  const quote = getQuoteForDay(nextDay);

  // Goggins-style milestones (sparse, not celebratory)
  let milestone = '';
  if (nextDay === 25) milestone = '\n\n25 days. You\'re just getting started.';
  if (nextDay === 38) milestone = '\n\nHalfway. Don\'t get comfortable.';
  if (nextDay === 50) milestone = '\n\n50. Most people have quit three times by now.';
  if (nextDay === 60) milestone = '\n\n15 left. This is where it gets real.';
  if (nextDay === 70) milestone = '\n\n5 days. Don\'t you dare let up.';

  // Simple morning message with quote
  const message = `Day ${nextDay}.\n\n"${quote}"${milestone}\n\nYou know what you owe.`;

  await bot.telegram.sendMessage(user.telegramId, message);
}
