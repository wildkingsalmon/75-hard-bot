import { Telegraf } from 'telegraf';
import * as storage from '../services/storage.js';
import { getQuoteForDay } from '../data/goggins-quotes.js';

// 6am: Start the new day - advance day counter, create dayLog, send morning message
export async function morningRoutine(bot: Telegraf): Promise<void> {
  console.log('Running 6am morning routine...');
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();

      // Only run at 6am
      if (currentHour !== 6) continue;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      // Check if previous day was complete
      const prevDayLog = await storage.getDayLog(user.id, user.currentDay);
      const prevDayComplete = prevDayLog
        ? storage.isDayComplete(prevDayLog, program.waterTarget || 128, program.dietMode || 'confirm', program.baseCalories || undefined).complete
        : false;

      // Advance to new day
      const prevDay = user.currentDay;
      await storage.advanceUserDay(user.id);
      const newDay = prevDay + 1;

      // Create dayLog for the new day
      const today = new Date().toLocaleDateString('en-CA', { timeZone: user.timezone });
      await storage.getOrCreateDayLog(user.id, newDay, today);

      // Get quote for the day
      const quote = getQuoteForDay(newDay);

      // Build morning message
      let message: string;
      if (!prevDayComplete && prevDay > 0) {
        // Previous day wasn't complete - acknowledge but move forward
        message = `Day ${newDay}.\n\nYesterday's in the past. You know what happened. Today's a new chance to prove who you really are.\n\n"${quote}"\n\nGet after it.`;
      } else {
        // Normal morning message
        const milestone = getMilestone(newDay);
        message = `Day ${newDay}.\n\n"${quote}"${milestone}\n\nTime to work.`;
      }

      await bot.telegram.sendMessage(user.telegramId, message);
      console.log(`Sent morning message to user ${user.telegramId} for Day ${newDay}`);
    } catch (error) {
      console.error(`Morning routine failed for user ${user.telegramId}:`, error);
    }
  }
}

function getMilestone(day: number): string {
  if (day === 25) return '\n\n25 days. You\'re just getting started.';
  if (day === 38) return '\n\nHalfway. Don\'t get comfortable.';
  if (day === 50) return '\n\n50. Most people have quit three times by now.';
  if (day === 60) return '\n\n15 left. This is where it gets real.';
  if (day === 70) return '\n\n5 days. Don\'t you dare let up.';
  return '';
}

// 5am check removed - morning routine at 6am handles everything
export async function checkDayResets(_bot: Telegraf): Promise<void> {
  // Kept for backwards compatibility but no longer used
}
