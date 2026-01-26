import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { checkDayResets } from '../agents/reset-checker.js';

export function startResetCron(bot: Telegraf): void {
  // Run every hour to catch 5am in different timezones
  // The actual timezone checking happens in checkDayResets
  cron.schedule('0 * * * *', async () => {
    console.log('Running day reset check...');
    try {
      await checkDayResets(bot);
    } catch (error) {
      console.error('Reset cron error:', error);
    }
  });

  console.log('Reset cron job started');
}
