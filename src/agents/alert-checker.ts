import { Telegraf } from 'telegraf';
import * as storage from '../services/storage.js';

// Goggins-style alerts - escalating brevity
const ALERT_MESSAGES: Record<number, string[]> = {
  19: [
    "You're not done.",
    "Still got work to do.",
    "Day's not over.",
  ],
  20: [
    "Still waiting.",
    "Two hours left.",
    "Handle it.",
  ],
  21: [
    "One hour.",
    "Clock's ticking.",
    "Get it done.",
  ],
  22: [
    "Last call.",
    "Now or never.",
    "Finish it.",
  ],
};

export async function checkAndSendAlerts(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();
      const currentMinute = userTime.getMinutes();

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      const alertTimes = program.alertTimes || ['19:00', '20:00', '21:00', '22:00'];

      // Check if current time matches any alert time (within 5 minute window)
      const shouldAlert = alertTimes.some(alertTime => {
        const [alertHour, alertMinute] = alertTime.split(':').map(Number);
        return currentHour === alertHour && Math.abs(currentMinute - alertMinute) < 5;
      });

      if (!shouldAlert) continue;

      const today = new Date().toISOString().split('T')[0];
      const dayLog = await storage.getDayLog(user.id, user.currentDay);

      if (!dayLog) continue;

      const baseCalories = program.baseCalories || program.bmr || 2000;
      const calorieInfo = storage.getDynamicCalorieTarget(baseCalories, dayLog);
      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieInfo.total);

      if (status.complete) continue;

      // Generate Goggins-style alert
      const alertMessage = generateGogginsAlert(currentHour, status.missing);
      await bot.telegram.sendMessage(user.telegramId, alertMessage);
    } catch (error) {
      console.error(`Alert check failed for user ${user.telegramId}:`, error);
    }
  }
}

function generateGogginsAlert(hour: number, missing: string[]): string {
  const messages = ALERT_MESSAGES[hour] || ALERT_MESSAGES[19];
  const base = messages[Math.floor(Math.random() * messages.length)];

  // First alert of the day gets context, later ones are just pressure
  if (hour === 19) {
    return `${base}\n\n${missing.join('. ')}.`;
  }

  return base;
}

export async function midnightCheck(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();

      if (currentHour !== 0) continue;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      const dayLog = await storage.getDayLog(user.id, user.currentDay);
      if (!dayLog) continue;

      const baseCalories = program.baseCalories || program.bmr || 2000;
      const calorieInfo = storage.getDynamicCalorieTarget(baseCalories, dayLog);
      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieInfo.total);

      if (!status.complete) {
        await bot.telegram.sendMessage(
          user.telegramId,
          `Day ${user.currentDay} incomplete.\n\n5am. You know what happens.`
        );
      }
    } catch (error) {
      console.error(`Midnight check failed for user ${user.telegramId}:`, error);
    }
  }
}
