import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { checkDayResets, morningRoutine } from '../agents/reset-checker.js';

export function startResetCron(bot: Telegraf): void {
  // Run every hour to catch 5am/6am in different timezones
  // The actual timezone checking happens in the functions
  cron.schedule('0 * * * *', async () => {
    try {
      // 5am: Check for incomplete days (optional warnings)
      await checkDayResets(bot);
      // 6am: Advance day, create dayLog, send morning message
      await morningRoutine(bot);
    } catch (error) {
      console.error('Reset/morning cron error:', error);
    }
  });

  console.log('Reset cron job started');
}
