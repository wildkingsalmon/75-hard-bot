import { Telegraf } from 'telegraf';
import * as storage from '../services/storage.js';

export async function checkDayResets(bot: Telegraf): Promise<void> {
  const users = await storage.getAllActiveUsers();
  const now = new Date();

  for (const user of users) {
    try {
      // Get user's local time
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const currentHour = userTime.getHours();

      // Only run at 5am (5:00-5:05)
      if (currentHour !== 5) continue;

      const program = await storage.getUserProgram(user.id);
      if (!program) continue;

      // Check yesterday's log (current day - they haven't advanced yet)
      const dayLog = await storage.getDayLog(user.id, user.currentDay);
      if (!dayLog) {
        // No log exists - they didn't even start the day
        await handleReset(bot, user, program, ['No activity logged']);
        continue;
      }

      const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);
      const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieTarget);

      if (!status.complete) {
        await handleReset(bot, user, program, status.missing);
      } else {
        // Day complete - advance to next day
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

  // Reset user to Day 1
  await storage.resetUserToDay1(user.id);

  // Create new Day 1 log
  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, 1, today);

  // Send reset notification
  const message = previousDay === 1
    ? `Day 1 incomplete. Missing: ${missing.join(', ')}.\n\n` +
      `You're still on Day 1. Today is a fresh start. Let's go.`
    : `Day ${previousDay} incomplete. Missing: ${missing.join(', ')}.\n\n` +
      `Resetting to Day 1. That's the rule. No exceptions, no modifications.\n\n` +
      `This is what builds mental toughness. You've got this. Day 1 starts now.`;

  await bot.telegram.sendMessage(user.telegramId, message);
}

async function handleDayAdvance(
  bot: Telegraf,
  user: storage.User,
  program: storage.UserProgram
): Promise<void> {
  const completedDay = user.currentDay;

  // Advance to next day
  await storage.advanceUserDay(user.id);

  const nextDay = completedDay + 1;

  // Create new day log
  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, nextDay, today);

  // Get calorie target for new day
  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], nextDay);

  // Check if calorie target changed
  const prevCalorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], completedDay);
  const calorieChangeNote = calorieTarget !== prevCalorieTarget
    ? `\n\n📊 Note: Calorie target changed to ${calorieTarget} cal.`
    : '';

  // Milestone messages
  let milestone = '';
  if (nextDay === 25) milestone = '\n\n🏅 1/3 of the way there!';
  if (nextDay === 38) milestone = '\n\n🏅 Halfway point!';
  if (nextDay === 50) milestone = '\n\n🏅 2/3 complete. The final stretch begins.';
  if (nextDay === 60) milestone = '\n\n🏅 15 days left. You can see the finish line.';
  if (nextDay === 70) milestone = '\n\n🏅 5 days left. Don\'t let up now.';

  const message = `☀️ Day ${nextDay} of 75\n\n` +
    `Yesterday: Complete ✅\n` +
    `Streak: ${completedDay} days\n` +
    `Remaining: ${75 - nextDay} days${milestone}${calorieChangeNote}\n\n` +
    `Today's checklist:\n` +
    `- [ ] Workout 1 (outdoor)\n` +
    `- [ ] Workout 2\n` +
    `- [ ] Diet (${calorieTarget} cal)\n` +
    `- [ ] Water (${program.waterTarget} oz)\n` +
    `- [ ] Read 10 pages\n` +
    `- [ ] Progress pic`;

  await bot.telegram.sendMessage(user.telegramId, message);
}
