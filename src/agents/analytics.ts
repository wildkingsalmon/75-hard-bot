import { eq } from 'drizzle-orm';
import { db, dayLogs } from '../db/index.js';
import { createMessage } from '../services/ai.js';
import type { User, UserProgram, DayLog } from '../db/schema.js';

export async function generateProgressReport(user: User, program: UserProgram): Promise<string> {
  // Get all day logs for this user
  const logs = await db
    .select()
    .from(dayLogs)
    .where(eq(dayLogs.userId, user.id))
    .orderBy(dayLogs.dayNumber);

  if (logs.length === 0) {
    return "No data yet. Complete a few days first.";
  }

  // Compile stats
  const stats = compileStats(logs, program);

  // Use Claude for analysis
  const response = await createMessage('analytics', {
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Analyze this 75 Hard progress. Be direct.

User: Day ${user.currentDay} of 75
Diet: ${program.dietType || 'Not specified'}
Total resets: ${stats.totalResets}
Current streak: ${stats.currentStreak} days

Workout consistency:
- Outdoor workout completion: ${stats.outdoorWorkoutRate}%
- Indoor workout completion: ${stats.indoorWorkoutRate}%

Nutrition:
- Meals logged: ${stats.totalMealsLogged}
- Average daily calories: ${stats.avgCalories}
- Average protein: ${stats.avgProtein}g

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

Keep it real. No fluff.`
    }]
  });

  const content = response.content[0];
  if (content.type === 'text') {
    return `**Progress Report - Day ${user.currentDay}**\n\n${content.text}`;
  }

  return "Unable to generate report.";
}

type Stats = {
  totalResets: number;
  currentStreak: number;
  outdoorWorkoutRate: number;
  indoorWorkoutRate: number;
  totalMealsLogged: number;
  avgCalories: number;
  avgProtein: number;
  readingRate: number;
  totalPagesRead: number;
  waterRate: number;
  progressPicRate: number;
  recentTrends: string;
};

function compileStats(logs: DayLog[], program: UserProgram): Stats {
  const totalDays = logs.length;

  // Count workout completions
  const outdoorComplete = logs.filter(l => l.outdoorWorkout?.done).length;
  const indoorComplete = logs.filter(l => l.indoorWorkout?.done).length;

  // Nutrition stats
  const daysWithMeals = logs.filter(l => l.diet?.calories_consumed && l.diet.calories_consumed > 0);
  const totalMealsLogged = logs.reduce((sum, l) => sum + (l.meals?.length || 0), 0);
  const avgCalories = daysWithMeals.length > 0
    ? Math.round(daysWithMeals.reduce((sum, l) => sum + (l.diet?.calories_consumed || 0), 0) / daysWithMeals.length)
    : 0;
  const avgProtein = daysWithMeals.length > 0
    ? Math.round(daysWithMeals.reduce((sum, l) => sum + (l.diet?.protein || 0), 0) / daysWithMeals.length)
    : 0;

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
  const recentWorkouts = recent.filter(l => l.outdoorWorkout?.done && l.indoorWorkout?.done).length;
  const recentReading = recent.filter(l => l.reading?.done).length;
  const recentWater = recent.filter(l => l.water?.done).length;
  const recentTrends = `Both workouts: ${recentWorkouts}/7, Reading: ${recentReading}/7, Water: ${recentWater}/7`;

  return {
    totalResets,
    currentStreak,
    outdoorWorkoutRate: Math.round((outdoorComplete / totalDays) * 100),
    indoorWorkoutRate: Math.round((indoorComplete / totalDays) * 100),
    totalMealsLogged,
    avgCalories,
    avgProtein,
    readingRate: Math.round((readingComplete / totalDays) * 100),
    totalPagesRead,
    waterRate: Math.round((waterComplete / totalDays) * 100),
    progressPicRate: Math.round((picComplete / totalDays) * 100),
    recentTrends
  };
}
