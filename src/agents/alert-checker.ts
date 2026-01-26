import Anthropic from '@anthropic-ai/sdk';
import { Telegraf } from 'telegraf';
import * as storage from '../services/storage.js';

const anthropic = new Anthropic();

export async function checkAndSendAlerts(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      // Get user's local time
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();
      const currentMinute = userTime.getMinutes();
      const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      const alertTimes = program.alertTimes || ['19:00', '20:00', '21:00', '22:00'];

      // Check if current time matches any alert time (within 5 minute window)
      const shouldAlert = alertTimes.some(alertTime => {
        const [alertHour, alertMinute] = alertTime.split(':').map(Number);
        return currentHour === alertHour && Math.abs(currentMinute - alertMinute) < 5;
      });

      if (!shouldAlert) continue;

      // Check if day is complete
      const today = new Date().toISOString().split('T')[0];
      const dayLog = await storage.getDayLog(user.id, user.currentDay);

      if (!dayLog) continue;

      const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);
      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieTarget);

      if (status.complete) continue;

      // Generate alert message using Haiku for efficiency
      const alertMessage = await generateAlertMessage(user.currentDay, status.missing, currentHour);

      await bot.telegram.sendMessage(user.telegramId, alertMessage);
    } catch (error) {
      console.error(`Alert check failed for user ${user.telegramId}:`, error);
    }
  }
}

async function generateAlertMessage(dayNumber: number, missing: string[], hour: number): Promise<string> {
  // Use Haiku for quick, efficient alert generation
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Generate a brief, motivating reminder for someone on Day ${dayNumber} of 75 Hard.
It's ${hour}:00 and they still need to complete: ${missing.join(', ')}.

Keep it under 50 words. Be supportive but direct - not corny. They know the stakes.
Don't use excessive emojis. One is fine.`
    }]
  });

  const content = response.content[0];
  if (content.type === 'text') {
    return content.text;
  }

  // Fallback message
  return `⏰ Day ${dayNumber} reminder: Still need to complete ${missing.join(', ')}. You've got this.`;
}

// Midnight check - if day is incomplete, prepare for reset
export async function midnightCheck(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();

      // Only run at midnight (0:00-0:05)
      if (currentHour !== 0) continue;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      const dayLog = await storage.getDayLog(user.id, user.currentDay);
      if (!dayLog) continue;

      const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);
      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieTarget);

      if (!status.complete) {
        // Send final warning
        await bot.telegram.sendMessage(
          user.telegramId,
          `⚠️ Day ${user.currentDay} is incomplete. Missing: ${status.missing.join(', ')}.\n\n` +
          `At 5am, if this isn't resolved, you'll reset to Day 1. That's the rule.`
        );
      }
    } catch (error) {
      console.error(`Midnight check failed for user ${user.telegramId}:`, error);
    }
  }
}
