import { eq, and } from 'drizzle-orm';
import { db, users, userPrograms, dayLogs, progressPics } from '../db/index.js';
import type {
  User, NewUser, UserProgram, NewUserProgram, DayLog, NewDayLog,
  CaloriePhase, Book, WorkoutLog, ReadingLog, WaterLog, DietLog, ProgressPicLog, Meal, OnboardingState
} from '../db/schema.js';

// User operations
export async function getUser(telegramId: number): Promise<User | null> {
  const result = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return result[0] || null;
}

export async function createUser(data: NewUser): Promise<User> {
  const result = await db.insert(users).values(data).returning();
  return result[0];
}

export async function updateUser(telegramId: number, data: Partial<NewUser>): Promise<User | null> {
  const result = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.telegramId, telegramId))
    .returning();
  return result[0] || null;
}

export async function updateOnboardingState(telegramId: number, state: OnboardingState): Promise<void> {
  await db
    .update(users)
    .set({ onboardingState: state, updatedAt: new Date() })
    .where(eq(users.telegramId, telegramId));
}

export async function completeOnboarding(telegramId: number, startDate: string): Promise<void> {
  await db
    .update(users)
    .set({
      onboardingComplete: true,
      onboardingState: null,
      startDate,
      currentDay: 1,
      updatedAt: new Date()
    })
    .where(eq(users.telegramId, telegramId));
}

export async function resetUserToDay1(userId: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db
    .update(users)
    .set({
      currentDay: 1,
      startDate: today,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId));
}

export async function advanceUserDay(userId: number): Promise<void> {
  await db
    .update(users)
    .set({
      currentDay: users.currentDay,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId));

  // Increment day
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user[0]) {
    await db
      .update(users)
      .set({ currentDay: user[0].currentDay + 1 })
      .where(eq(users.id, userId));
  }
}

// User program operations
export async function getUserProgram(userId: number): Promise<UserProgram | null> {
  const result = await db.select().from(userPrograms).where(eq(userPrograms.userId, userId)).limit(1);
  return result[0] || null;
}

export async function createUserProgram(data: NewUserProgram): Promise<UserProgram> {
  const result = await db.insert(userPrograms).values(data).returning();
  return result[0];
}

export async function updateUserProgram(userId: number, data: Partial<NewUserProgram>): Promise<UserProgram | null> {
  const result = await db
    .update(userPrograms)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(userPrograms.userId, userId))
    .returning();
  return result[0] || null;
}

export function getCalorieTargetForDay(phases: CaloriePhase[], dayNumber: number): number {
  const phase = phases.find(p => dayNumber >= p.start_day && dayNumber <= p.end_day);
  return phase?.target_calories || phases[phases.length - 1]?.target_calories || 2000;
}

// Dynamic calorie target: base + workout calories burned
export function getDynamicCalorieTarget(
  baseCalories: number,
  dayLog: DayLog | null
): { base: number; burned: number; total: number } {
  const workout1Burn = dayLog?.workout1?.calories_burned || 0;
  const workout2Burn = dayLog?.workout2?.calories_burned || 0;
  const totalBurned = workout1Burn + workout2Burn;

  return {
    base: baseCalories,
    burned: totalBurned,
    total: baseCalories + totalBurned
  };
}

// Day log operations
export async function getDayLog(userId: number, dayNumber: number): Promise<DayLog | null> {
  const result = await db
    .select()
    .from(dayLogs)
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)))
    .limit(1);
  return result[0] || null;
}

export async function getOrCreateDayLog(userId: number, dayNumber: number, date: string): Promise<DayLog> {
  let log = await getDayLog(userId, dayNumber);
  if (!log) {
    const result = await db
      .insert(dayLogs)
      .values({ userId, dayNumber, date, meals: [] })
      .returning();
    log = result[0];
  }
  return log;
}

export async function updateDayLog(
  userId: number,
  dayNumber: number,
  data: Partial<Omit<NewDayLog, 'userId' | 'dayNumber' | 'date'>>
): Promise<DayLog | null> {
  const result = await db
    .update(dayLogs)
    .set(data)
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)))
    .returning();
  return result[0] || null;
}

export async function logWorkout1(userId: number, dayNumber: number, workout: WorkoutLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ workout1: workout })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function logWorkout2(userId: number, dayNumber: number, workout: WorkoutLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ workout2: workout })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function logReading(userId: number, dayNumber: number, reading: ReadingLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ reading })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function logWater(userId: number, dayNumber: number, water: WaterLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ water })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function addMeal(userId: number, dayNumber: number, meal: Meal): Promise<DayLog | null> {
  const log = await getDayLog(userId, dayNumber);
  if (!log) return null;

  const meals = [...(log.meals || []), meal];
  const totalCals = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);

  const result = await db
    .update(dayLogs)
    .set({
      meals,
      diet: {
        done: false, // Will be evaluated at end of day
        calories_consumed: totalCals,
        protein: totalProtein,
        carbs: totalCarbs,
        fat: totalFat,
        logged_at: new Date().toISOString()
      }
    })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)))
    .returning();

  return result[0] || null;
}

export async function logProgressPic(userId: number, dayNumber: number, pic: ProgressPicLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ progressPic: pic })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function markDayComplete(userId: number, dayNumber: number): Promise<void> {
  await db
    .update(dayLogs)
    .set({ completed: true, completedAt: new Date() })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export function isDayComplete(log: DayLog, waterTarget: number, calorieTarget: number): {
  complete: boolean;
  missing: string[];
  calorieStatus: 'under' | 'at' | 'over';
} {
  const missing: string[] = [];

  if (!log.workout1?.done) missing.push('Workout 1 (outdoor)');
  if (!log.workout2?.done) missing.push('Workout 2');
  if (!log.reading?.done) missing.push('Read 10 pages');
  if (!log.water?.done || (log.water.amount_oz < waterTarget)) missing.push('Water');
  if (!log.progressPic?.done) missing.push('Progress pic');

  const caloriesConsumed = log.diet?.calories_consumed || 0;
  let calorieStatus: 'under' | 'at' | 'over' = 'under';

  if (caloriesConsumed > calorieTarget) {
    calorieStatus = 'over';
    missing.push('Diet (over calories)');
  } else if (caloriesConsumed === calorieTarget) {
    calorieStatus = 'at';
  }

  return {
    complete: missing.length === 0,
    missing,
    calorieStatus
  };
}

// Progress pics storage
export async function saveProgressPic(userId: number, dayNumber: number, fileId: string): Promise<void> {
  await db.insert(progressPics).values({
    userId,
    dayNumber,
    telegramFileId: fileId
  });
}

export async function getProgressPics(userId: number): Promise<{ dayNumber: number; telegramFileId: string }[]> {
  return await db
    .select({ dayNumber: progressPics.dayNumber, telegramFileId: progressPics.telegramFileId })
    .from(progressPics)
    .where(eq(progressPics.userId, userId))
    .orderBy(progressPics.dayNumber);
}

// Get all users for cron jobs
export async function getAllActiveUsers(): Promise<User[]> {
  return await db
    .select()
    .from(users)
    .where(eq(users.onboardingComplete, true));
}

// Get user with program
export async function getUserWithProgram(telegramId: number): Promise<{ user: User; program: UserProgram } | null> {
  const user = await getUser(telegramId);
  if (!user) return null;

  const program = await getUserProgram(user.id);
  if (!program) return null;

  return { user, program };
}

// Re-export types for convenience
export type { User, UserProgram, DayLog, CaloriePhase, Book } from '../db/schema.js';
