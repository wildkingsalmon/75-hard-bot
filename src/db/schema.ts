import { pgTable, serial, text, integer, boolean, timestamp, jsonb, bigint, date } from 'drizzle-orm/pg-core';

// Type definitions for JSONB fields
export type CaloriePhase = {
  start_day: number;
  end_day: number;
  target_calories: number;
  label: string;
};

export type Book = {
  title: string;
  total_pages: number | null;
  current_page: number;
  started_day: number;
  finished_day: number | null;
};

export type WorkoutLog = {
  done: boolean;
  outdoor: boolean;
  duration_mins: number;
  notes: string | null;
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
  done: boolean;
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
  height: integer('height'), // inches
  weight: integer('weight'), // lbs
  age: integer('age'),
  activityLevel: text('activity_level'), // sedentary, light, moderate, active, very_active
  bmr: integer('bmr'),
  tdee: integer('tdee'),
  caloriePhases: jsonb('calorie_phases').$type<CaloriePhase[]>().default([]),
  proteinTarget: integer('protein_target'), // grams
  waterTarget: integer('water_target'), // oz
  books: jsonb('books').$type<Book[]>().default([]),
  workoutOutdoorType: text('workout_outdoor_type'),
  workoutIndoorType: text('workout_indoor_type'),
  progressPicTime: text('progress_pic_time'), // HH:MM format
  alertTimes: jsonb('alert_times').$type<string[]>().default(['19:00', '20:00', '21:00', '22:00']),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dayLogs = pgTable('day_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  dayNumber: integer('day_number').notNull(),
  date: date('date').notNull(),
  workout1: jsonb('workout1').$type<WorkoutLog>(),
  workout2: jsonb('workout2').$type<WorkoutLog>(),
  reading: jsonb('reading').$type<ReadingLog>(),
  water: jsonb('water').$type<WaterLog>(),
  diet: jsonb('diet').$type<DietLog>(),
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
