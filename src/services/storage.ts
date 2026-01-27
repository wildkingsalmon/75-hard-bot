import { eq, and } from 'drizzle-orm';
import { db, users, userPrograms, dayLogs, progressPics } from '../db/index.js';
import type {
  User, NewUser, UserProgram, NewUserProgram, DayLog, NewDayLog,
  Book, WorkoutLog, ReadingLog, WaterLog, DietLog, ProgressPicLog, Meal, OnboardingState,
  UserContext, UserGoal, UserNote
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
  // Get current day and increment atomically
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user[0]) {
    await db
      .update(users)
      .set({
        currentDay: user[0].currentDay + 1,
        updatedAt: new Date()
      })
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

// User context operations - for storing goals, notes, etc. learned through conversation
export async function getUserContext(userId: number): Promise<UserContext | null> {
  const program = await getUserProgram(userId);
  return program?.context || null;
}

export async function addUserGoal(userId: number, goal: UserGoal): Promise<void> {
  const program = await getUserProgram(userId);
  if (!program) return;

  const context = program.context || { goals: [], why: null, struggles: [], notes: [] };
  context.goals.push(goal);

  await db
    .update(userPrograms)
    .set({ context, updatedAt: new Date() })
    .where(eq(userPrograms.userId, userId));
}

export async function updateUserWhy(userId: number, why: string): Promise<void> {
  const program = await getUserProgram(userId);
  if (!program) return;

  const context = program.context || { goals: [], why: null, struggles: [], notes: [] };
  context.why = why;

  await db
    .update(userPrograms)
    .set({ context, updatedAt: new Date() })
    .where(eq(userPrograms.userId, userId));
}

export async function addUserStruggle(userId: number, struggle: string): Promise<void> {
  const program = await getUserProgram(userId);
  if (!program) return;

  const context = program.context || { goals: [], why: null, struggles: [], notes: [] };
  if (!context.struggles.includes(struggle)) {
    context.struggles.push(struggle);
  }

  await db
    .update(userPrograms)
    .set({ context, updatedAt: new Date() })
    .where(eq(userPrograms.userId, userId));
}

export async function addUserNote(userId: number, note: UserNote): Promise<void> {
  const program = await getUserProgram(userId);
  if (!program) return;

  const context = program.context || { goals: [], why: null, struggles: [], notes: [] };
  context.notes.push(note);

  await db
    .update(userPrograms)
    .set({ context, updatedAt: new Date() })
    .where(eq(userPrograms.userId, userId));
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

export async function logOutdoorWorkout(userId: number, dayNumber: number, workout: WorkoutLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ outdoorWorkout: workout })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function logIndoorWorkout(userId: number, dayNumber: number, workout: WorkoutLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ indoorWorkout: workout })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function logReading(userId: number, dayNumber: number, reading: ReadingLog): Promise<void> {
  await db
    .update(dayLogs)
    .set({ reading })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function confirmDiet(userId: number, dayNumber: number): Promise<void> {
  await db
    .update(dayLogs)
    .set({ dietConfirmed: true })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));
}

export async function addWater(userId: number, dayNumber: number, amountOz: number, waterTarget: number): Promise<WaterLog> {
  const log = await getDayLog(userId, dayNumber);
  const currentAmount = log?.water?.amount_oz || 0;
  const newAmount = currentAmount + amountOz;
  const isDone = newAmount >= waterTarget;

  const water: WaterLog = {
    done: isDone,
    amount_oz: newAmount,
    logged_at: new Date().toISOString()
  };

  await db
    .update(dayLogs)
    .set({ water })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));

  return water;
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

export async function deleteLastMeal(userId: number, dayNumber: number): Promise<DayLog | null> {
  const log = await getDayLog(userId, dayNumber);
  if (!log || !log.meals || log.meals.length === 0) return null;

  const meals = log.meals.slice(0, -1);
  const totalCals = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);

  const result = await db
    .update(dayLogs)
    .set({
      meals,
      diet: {
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

export async function updateLastMeal(userId: number, dayNumber: number, updatedMeal: Meal): Promise<DayLog | null> {
  const log = await getDayLog(userId, dayNumber);
  if (!log || !log.meals || log.meals.length === 0) return null;

  const meals = [...log.meals.slice(0, -1), updatedMeal];
  const totalCals = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);

  const result = await db
    .update(dayLogs)
    .set({
      meals,
      diet: {
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

export async function clearMeals(userId: number, dayNumber: number): Promise<DayLog | null> {
  const result = await db
    .update(dayLogs)
    .set({
      meals: [],
      diet: {
        calories_consumed: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        logged_at: new Date().toISOString()
      }
    })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)))
    .returning();

  return result[0] || null;
}

export async function deleteWater(userId: number, dayNumber: number, amountToRemove: number, waterTarget: number): Promise<WaterLog> {
  const log = await getDayLog(userId, dayNumber);
  const currentAmount = log?.water?.amount_oz || 0;
  const newAmount = Math.max(0, currentAmount - amountToRemove);

  const water: WaterLog = {
    done: newAmount >= waterTarget,
    amount_oz: newAmount,
    logged_at: new Date().toISOString()
  };

  await db
    .update(dayLogs)
    .set({ water })
    .where(and(eq(dayLogs.userId, userId), eq(dayLogs.dayNumber, dayNumber)));

  return water;
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

export function isDayComplete(log: DayLog, waterTarget: number, dietMode: string, baseCalories?: number): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (!log.outdoorWorkout?.done) missing.push('Outdoor workout');
  if (!log.indoorWorkout?.done) missing.push('Indoor workout');
  if (!log.reading?.done) missing.push('Read 10 pages');
  if (!log.water?.done || (log.water.amount_oz < waterTarget)) missing.push('Water');
  if (!log.progressPic?.done) missing.push('Progress pic');

  // Diet check based on mode
  if (dietMode === 'confirm') {
    if (!log.dietConfirmed) missing.push('Confirm diet');
  } else if (dietMode === 'deficit') {
    // Deficit mode: eaten must be <= budget (baseCalories + workout calories)
    const base = baseCalories || 2000;
    const workoutCals = (log.outdoorWorkout?.calories_burned || 0) + (log.indoorWorkout?.calories_burned || 0);
    const budget = base + workoutCals;
    const eaten = log.diet?.calories_consumed || 0;

    if (eaten > budget) {
      const over = eaten - budget;
      missing.push(`${over} cal over budget`);
    }
  } else {
    // track mode - need at least one meal logged
    if (!log.meals || log.meals.length === 0) missing.push('Log food');
  }

  return {
    complete: missing.length === 0,
    missing
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
export type { User, UserProgram, DayLog, Book, UserContext, UserGoal, UserNote } from '../db/schema.js';
