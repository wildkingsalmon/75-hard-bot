import { pgTable, serial, text, integer, boolean, timestamp, jsonb, bigint, date } from 'drizzle-orm/pg-core';

// Type definitions for JSONB fields
export type Book = {
  title: string;
  total_pages: number | null;
  current_page: number;
  started_day: number;
  finished_day: number | null;
};

// Workout log - done/not done with optional details and calories burned
export type WorkoutLog = {
  done: boolean;
  description: string | null;
  calories_burned: number | null; // Optional for deficit tracking
  photo_id: string | null;
  logged_at: string;
};

export type ReadingLog = {
  done: boolean;
  pages: number;
  book: string;
  logged_at: string;
};

export type WaterLog = {
  done: boolean;
  amount_oz: number;
  logged_at: string;
};

export type DietLog = {
  calories_consumed: number;
  protein: number;
  carbs: number;
  fat: number;
  logged_at: string;
};

export type ProgressPicLog = {
  done: boolean;
  file_id: string | null;
  logged_at: string;
};

export type Meal = {
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  logged_at: string;
};

export type OnboardingState = {
  step: string;
  data: Record<string, unknown>;
};

// User context - goals and notes learned through conversation
export type UserGoal = {
  type: string; // 'weight', 'fitness', 'habit', 'other'
  description: string;
  mentioned_at: string;
};

export type UserNote = {
  note: string;
  mentioned_at: string;
};

export type UserContext = {
  goals: UserGoal[];
  why: string | null; // Why they're doing 75 Hard
  struggles: string[]; // Things they struggle with
  notes: UserNote[]; // Misc notes about the user
};

// Tables
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  currentDay: integer('current_day').default(0).notNull(),
  startDate: date('start_date'),
  timezone: text('timezone').default('America/New_York').notNull(),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  onboardingState: jsonb('onboarding_state').$type<OnboardingState>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userPrograms = pgTable('user_programs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  // Diet - flexible, user describes their diet type
  dietType: text('diet_type'), // "keto", "counting calories", "clean eating", "no alcohol", etc.
  dietMode: text('diet_mode').default('confirm'), // 'confirm' | 'track' | 'deficit'
  // Deficit mode settings
  baseCalories: integer('base_calories'), // TDEE/maintenance for deficit calculation
  // Optional macro targets (for track/deficit modes)
  calorieTarget: integer('calorie_target'),
  proteinTarget: integer('protein_target'),
  carbTarget: integer('carb_target'),
  fatTarget: integer('fat_target'),
  // Water
  waterTarget: integer('water_target').default(128), // oz (default 1 gallon)
  // Reading
  books: jsonb('books').$type<Book[]>().default([]),
  // Alerts
  alertTimes: jsonb('alert_times').$type<string[]>().default(['19:00', '20:00', '21:00', '22:00']),
  // User context - goals, why, struggles, notes learned through conversation
  context: jsonb('context').$type<UserContext>().default({ goals: [], why: null, struggles: [], notes: [] }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dayLogs = pgTable('day_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  dayNumber: integer('day_number').notNull(),
  date: date('date').notNull(),
  // Workouts - simple outdoor/indoor tracking
  outdoorWorkout: jsonb('outdoor_workout').$type<WorkoutLog>(),
  indoorWorkout: jsonb('indoor_workout').$type<WorkoutLog>(),
  // Other tasks
  reading: jsonb('reading').$type<ReadingLog>(),
  water: jsonb('water').$type<WaterLog>(),
  diet: jsonb('diet').$type<DietLog>(),
  dietConfirmed: boolean('diet_confirmed').default(false), // For 'confirm' mode users
  progressPic: jsonb('progress_pic').$type<ProgressPicLog>(),
  meals: jsonb('meals').$type<Meal[]>().default([]),
  completed: boolean('completed').default(false).notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const progressPics = pgTable('progress_pics', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  dayNumber: integer('day_number').notNull(),
  telegramFileId: text('telegram_file_id').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

// Infer types for use in application
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProgram = typeof userPrograms.$inferSelect;
export type NewUserProgram = typeof userPrograms.$inferInsert;
export type DayLog = typeof dayLogs.$inferSelect;
export type NewDayLog = typeof dayLogs.$inferInsert;
export type ProgressPic = typeof progressPics.$inferSelect;
export type NewProgressPic = typeof progressPics.$inferInsert;
