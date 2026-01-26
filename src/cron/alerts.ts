import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { checkAndSendAlerts, midnightCheck } from '../agents/alert-checker.js';

export function startAlertCron(bot: Telegraf): void {
  // Run every hour from 7pm to 11pm (covering most timezones)
  // The actual timezone checking happens in checkAndSendAlerts
  cron.schedule('0 * * * *', async () => {
    console.log('Running hourly alert check...');
    try {
      await checkAndSendAlerts(bot);
    } catch (error) {
      console.error('Alert cron error:', error);
    }
  });

  // Midnight check - runs every hour to catch different timezones
  cron.schedule('5 * * * *', async () => {
    console.log('Running midnight check...');
    try {
      await midnightCheck(bot);
    } catch (error) {
      console.error('Midnight check cron error:', error);
    }
  });

  console.log('Alert cron jobs started');
}
