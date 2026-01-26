import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db, dayLogs } from '../db/index.js';
import * as storage from '../services/storage.js';
import type { User, UserProgram, DayLog } from '../db/schema.js';

const anthropic = new Anthropic();

export async function generateProgressReport(user: User, program: UserProgram): Promise<string> {
  // Get all day logs for this user
  const logs = await db
    .select()
    .from(dayLogs)
    .where(eq(dayLogs.userId, user.id))
    .orderBy(dayLogs.dayNumber);

  if (logs.length === 0) {
    return "No data yet. Complete a few days first!";
  }

  // Compile stats
  const stats = compileStats(logs, program);

  // Use Opus for deep analysis
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', // Using Sonnet as Opus fallback for cost efficiency
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Analyze this 75 Hard progress and provide insights. Be direct and useful.

User: Day ${user.currentDay} of 75
Total resets: ${stats.totalResets}
Current streak: ${stats.currentStreak} days

Workout consistency:
- Workout 1 completion: ${stats.workout1Rate}%
- Workout 2 completion: ${stats.workout2Rate}%
- Average duration: ${stats.avgWorkoutDuration} mins

Nutrition:
- Average daily calories: ${stats.avgCalories}
- Target: ${stats.calorieTarget}
- Days over target: ${stats.daysOverCalories}
- Average protein: ${stats.avgProtein}g / ${program.proteinTarget}g target

Reading:
- Completion rate: ${stats.readingRate}%
- Total pages: ${stats.totalPagesRead}

Water:
- Completion rate: ${stats.waterRate}%

Progress pics:
- Logged: ${stats.progressPicRate}%

Recent trends (last 7 days):
${stats.recentTrends}

Provide:
1. Overall assessment (2-3 sentences)
2. Biggest strength
3. Area needing attention
4. One specific, actionable recommendation

Keep it real and supportive. No fluff.`
    }]
  });

  const content = response.content[0];
  if (content.type === 'text') {
    return `📊 **Progress Report - Day ${user.currentDay}**\n\n${content.text}`;
  }

  return "Unable to generate report. Try again later.";
}

type Stats = {
  totalResets: number;
  currentStreak: number;
  workout1Rate: number;
  workout2Rate: number;
  avgWorkoutDuration: number;
  avgCalories: number;
  calorieTarget: number;
  daysOverCalories: number;
  avgProtein: number;
  readingRate: number;
  totalPagesRead: number;
  waterRate: number;
  progressPicRate: number;
  recentTrends: string;
};

function compileStats(logs: DayLog[], program: UserProgram): Stats {
  const completedLogs = logs.filter(l => l.completed);
  const totalDays = logs.length;

  // Count workout completions
  const workout1Complete = logs.filter(l => l.workout1?.done).length;
  const workout2Complete = logs.filter(l => l.workout2?.done).length;

  // Calculate average workout duration
  const allWorkouts = [
    ...logs.map(l => l.workout1?.duration_mins).filter(Boolean),
    ...logs.map(l => l.workout2?.duration_mins).filter(Boolean)
  ] as number[];
  const avgWorkoutDuration = allWorkouts.length > 0
    ? Math.round(allWorkouts.reduce((a, b) => a + b, 0) / allWorkouts.length)
    : 0;

  // Nutrition stats
  const daysWithMeals = logs.filter(l => l.diet?.calories_consumed && l.diet.calories_consumed > 0);
  const avgCalories = daysWithMeals.length > 0
    ? Math.round(daysWithMeals.reduce((sum, l) => sum + (l.diet?.calories_consumed || 0), 0) / daysWithMeals.length)
    : 0;
  const avgProtein = daysWithMeals.length > 0
    ? Math.round(daysWithMeals.reduce((sum, l) => sum + (l.diet?.protein || 0), 0) / daysWithMeals.length)
    : 0;

  // Calculate current calorie target (for latest day)
  const latestDay = logs[logs.length - 1]?.dayNumber || 1;
  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], latestDay);

  // Days over calorie target
  const daysOverCalories = daysWithMeals.filter(l => {
    const dayTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], l.dayNumber);
    return (l.diet?.calories_consumed || 0) > dayTarget;
  }).length;

  // Reading stats
  const readingComplete = logs.filter(l => l.reading?.done).length;
  const totalPagesRead = logs.reduce((sum, l) => sum + (l.reading?.pages || 0), 0);

  // Water stats
  const waterComplete = logs.filter(l => l.water?.done).length;

  // Progress pic stats
  const picComplete = logs.filter(l => l.progressPic?.done).length;

  // Estimate resets (days where day number restarted)
  let totalResets = 0;
  for (let i = 1; i < logs.length; i++) {
    if (logs[i].dayNumber < logs[i - 1].dayNumber) {
      totalResets++;
    }
  }

  // Current streak (consecutive completed days from most recent)
  let currentStreak = 0;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].completed) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Recent trends (last 7 days)
  const recent = logs.slice(-7);
  const recentWorkouts = recent.filter(l => l.workout1?.done && l.workout2?.done).length;
  const recentReading = recent.filter(l => l.reading?.done).length;
  const recentWater = recent.filter(l => l.water?.done).length;
  const recentTrends = `Workouts: ${recentWorkouts}/7, Reading: ${recentReading}/7, Water: ${recentWater}/7`;

  return {
    totalResets,
    currentStreak,
    workout1Rate: Math.round((workout1Complete / totalDays) * 100),
    workout2Rate: Math.round((workout2Complete / totalDays) * 100),
    avgWorkoutDuration,
    avgCalories,
    calorieTarget,
    daysOverCalories,
    avgProtein,
    readingRate: Math.round((readingComplete / totalDays) * 100),
    totalPagesRead,
    waterRate: Math.round((waterComplete / totalDays) * 100),
    progressPicRate: Math.round((picComplete / totalDays) * 100),
    recentTrends
  };
}
