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
        await handleReset(bot, user, program, ['No activity logged']);
        continue;
      }

      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, program.dietMode || 'confirm', program.baseCalories || undefined);

      if (!status.complete) {
        await handleReset(bot, user, program, status.missing);
      } else {
        await handleDayAdvance(bot, user, program);
      }
    } catch (error) {
      console.error(`Reset check failed for user ${user.telegramId}:`, error);
    }
  }
}

async function handleReset(
  bot: Telegraf,
  user: storage.User,
  program: storage.UserProgram,
  missing: string[]
): Promise<void> {
  const previousDay = user.currentDay;

  await storage.resetUserToDay1(user.id);

  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, 1, today);

  // Goggins-style reset messages - varies by how far they got
  let message: string;

  if (previousDay === 1) {
    message = `Day 1. Incomplete.\n\nYou're still at the starting line. That's fine. Most people never even get here.\n\nGo again.`;
  } else if (previousDay < 10) {
    message = `Day ${previousDay}. Gone.\n\nBack to Day 1. Most people quit right here. They tell themselves they'll start again Monday.\n\nProve you're not most people.`;
  } else if (previousDay < 30) {
    message = `${previousDay} days. Gone.\n\nThat stings. Good. Remember this feeling next time you think about cutting corners.\n\nDay 1.`;
  } else if (previousDay < 50) {
    message = `${previousDay} days. All of it. Gone.\n\nYou were building something. Now you get to find out if you actually want it.\n\nDay 1. Again.`;
  } else {
    message = `${previousDay} days.\n\nYou were close. That's gonna hurt for a while. Let it.\n\nThe question now is simple: are you done, or are you just getting started?\n\nDay 1.`;
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
