import Anthropic from '@anthropic-ai/sdk';
import { Context } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import * as storage from '../services/storage.js';
import { parseFoodEntry, formatMealTable, formatDailySummary, mealFromParsed } from '../services/nutrition.js';
import type { OnboardingState, CaloriePhase, Book, User, UserProgram, DayLog } from '../db/schema.js';

const anthropic = new Anthropic();

type TextContext = Context<Update> & { message: Message.TextMessage };
type PhotoContext = Context<Update> & { message: Message.PhotoMessage };

// Onboarding steps
const ONBOARDING_STEPS = [
  'welcome',
  'height',
  'weight',
  'age',
  'activity_level',
  'calorie_phases',
  'protein_target',
  'water_target',
  'first_book',
  'workout_outdoor',
  'workout_indoor',
  'progress_pic_time',
  'alert_times',
  'confirm'
] as const;

type OnboardingStep = typeof ONBOARDING_STEPS[number];

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let user = await storage.getUser(telegramId);

  if (!user) {
    user = await storage.createUser({
      telegramId,
      username: ctx.from?.username || null,
      firstName: ctx.from?.first_name || null,
      onboardingState: { step: 'welcome', data: {} }
    });
    await storage.createUserProgram({ userId: user.id });
  }

  if (user.onboardingComplete) {
    await ctx.reply(
      `Welcome back! You're on Day ${user.currentDay} of 75 Hard.\n\n` +
      `Send /status to see today's progress, or just tell me what you've done.`
    );
    return;
  }

  // Start or resume onboarding
  await sendOnboardingMessage(ctx, user, 'welcome');
}

async function sendOnboardingMessage(ctx: Context, user: User, step: OnboardingStep): Promise<void> {
  const state = user.onboardingState || { step, data: {} };

  const messages: Record<OnboardingStep, string> = {
    welcome: `Hey! Ready to crush 75 Hard? Let's set up your program.\n\nFirst, what's your height? (e.g., "5'10" or "178 cm")`,

    height: `Got it. What's your current weight? (e.g., "185 lbs" or "84 kg")`,

    weight: `Perfect. How old are you?`,

    age: `And what's your activity level?\n\n` +
      `1. Sedentary (desk job, little exercise)\n` +
      `2. Light (light exercise 1-3 days/week)\n` +
      `3. Moderate (moderate exercise 3-5 days/week)\n` +
      `4. Active (hard exercise 6-7 days/week)\n` +
      `5. Very Active (physical job + hard exercise)\n\n` +
      `Just send the number.`,

    activity_level: (() => {
      const { bmr, tdee } = state.data as { bmr?: number; tdee?: number };
      return `Based on your stats, your estimated:\n` +
        `• BMR: ${bmr || '~2000'} cal/day\n` +
        `• TDEE: ${tdee || '~2500'} cal/day\n\n` +
        `Now let's set your calorie phases. You can have different targets for different parts of the 75 days.\n\n` +
        `Example: "2920 for days 1-28, 2670 for days 29-49, 2420 for days 50-75"\n\n` +
        `Or just send a single number like "2500" to use the same target throughout.`;
    })(),

    calorie_phases: `Great. What's your daily protein target in grams?\n\n` +
      `Recommendation: 0.8-1g per pound of body weight. For someone at ${(state.data as { weight?: number }).weight || 180} lbs, that's ${Math.round(((state.data as { weight?: number }).weight || 180) * 0.9)}g.\n\n` +
      `Send a number, or "auto" to use 1g per lb.`,

    protein_target: `What's your daily water target in ounces?\n\n` +
      `The original 75 Hard requires a gallon (128 oz), but you can set your own goal.\n\n` +
      `Send a number like "128" or "100".`,

    water_target: `What book are you starting with? Send the title, and optionally the total pages.\n\n` +
      `Example: "Atomic Habits, 320 pages" or just "Atomic Habits"`,

    first_book: `What type of outdoor workout will you typically do?\n\n` +
      `Examples: Running, Walking, Cycling, Hiking, etc.`,

    workout_outdoor: `And for your indoor/second workout?\n\n` +
      `Examples: Gym/weights, Home workout, Yoga, Swimming, etc.`,

    workout_indoor: `When will you take your daily progress pic? Send a time.\n\n` +
      `Examples: "7am", "after workout 1", "8:30pm"`,

    progress_pic_time: `Last thing: when should I send you reminder alerts if your day isn't complete?\n\n` +
      `Default is 7pm, 8pm, 9pm, 10pm. You can customize or just say "default".`,

    alert_times: (() => {
      const data = state.data as Record<string, unknown>;
      const phases = data.calorie_phases as CaloriePhase[] || [];
      const book = data.books as Book[] || [];

      return `Here's your 75 Hard program:\n\n` +
        `📊 **Stats**\n` +
        `• Height: ${data.height}\n` +
        `• Weight: ${data.weight} lbs\n` +
        `• TDEE: ${data.tdee} cal\n\n` +
        `🍽️ **Nutrition**\n` +
        `• Calories: ${phases.map(p => `${p.target_calories} (Days ${p.start_day}-${p.end_day})`).join(', ')}\n` +
        `• Protein: ${data.protein_target}g\n` +
        `• Water: ${data.water_target} oz\n\n` +
        `📖 **Reading**: ${book[0]?.title || 'Not set'}\n\n` +
        `🏋️ **Workouts**\n` +
        `• Outdoor: ${data.workout_outdoor}\n` +
        `• Indoor: ${data.workout_indoor}\n\n` +
        `📸 Progress pic: ${data.progress_pic_time}\n` +
        `⏰ Alerts: ${(data.alert_times as string[])?.join(', ')}\n\n` +
        `Ready to start? Send "START" to begin Day 1!`;
    })(),

    confirm: `You're all set! Day 1 starts now. Let's go! 💪\n\n` +
      `**Today's Tasks:**\n` +
      `- [ ] Workout 1 (45 min, outdoor)\n` +
      `- [ ] Workout 2 (45 min, any)\n` +
      `- [ ] Follow diet (at or under calorie target)\n` +
      `- [ ] Water (hit your target)\n` +
      `- [ ] Read 10 pages\n` +
      `- [ ] Progress pic\n\n` +
      `Just message me when you complete something, like "did my outdoor run" or "ate 2 eggs and toast".`
  };

  await storage.updateOnboardingState(user.telegramId, { step, data: state.data });
  await ctx.reply(messages[step]);
}

async function handleOnboarding(ctx: TextContext, user: User, message: string): Promise<void> {
  const state = user.onboardingState;
  if (!state) {
    await sendOnboardingMessage(ctx, user, 'welcome');
    return;
  }

  const currentStep = state.step as OnboardingStep;
  const data = state.data as Record<string, unknown>;

  // Process current step and determine next
  let nextStep: OnboardingStep | null = null;

  switch (currentStep) {
    case 'welcome':
      // Parse height
      const heightMatch = message.match(/(\d+)['\s]*(\d+)?|(\d+)\s*cm/i);
      if (heightMatch) {
        let inches: number;
        if (heightMatch[3]) {
          // cm format
          inches = Math.round(parseInt(heightMatch[3]) / 2.54);
        } else {
          // feet/inches format
          inches = parseInt(heightMatch[1]) * 12 + (parseInt(heightMatch[2]) || 0);
        }
        data.height = `${Math.floor(inches / 12)}'${inches % 12}"`;
        data.height_inches = inches;
        nextStep = 'height';
      } else {
        await ctx.reply(`I didn't catch that. Please enter your height like "5'10" or "178 cm".`);
        return;
      }
      break;

    case 'height':
      // Parse weight
      const weightMatch = message.match(/(\d+)\s*(lbs?|kg)?/i);
      if (weightMatch) {
        let lbs = parseInt(weightMatch[1]);
        if (weightMatch[2]?.toLowerCase() === 'kg') {
          lbs = Math.round(lbs * 2.205);
        }
        data.weight = lbs;
        nextStep = 'weight';
      } else {
        await ctx.reply(`Please enter your weight like "185 lbs" or "84 kg".`);
        return;
      }
      break;

    case 'weight':
      // Parse age
      const age = parseInt(message);
      if (age > 0 && age < 120) {
        data.age = age;
        nextStep = 'age';
      } else {
        await ctx.reply(`Please enter a valid age.`);
        return;
      }
      break;

    case 'age':
      // Parse activity level
      const activityMap: Record<string, { label: string; multiplier: number }> = {
        '1': { label: 'sedentary', multiplier: 1.2 },
        '2': { label: 'light', multiplier: 1.375 },
        '3': { label: 'moderate', multiplier: 1.55 },
        '4': { label: 'active', multiplier: 1.725 },
        '5': { label: 'very_active', multiplier: 1.9 }
      };
      const activity = activityMap[message.trim()];
      if (activity) {
        data.activity_level = activity.label;

        // Calculate BMR (Mifflin-St Jeor)
        const weightKg = (data.weight as number) / 2.205;
        const heightCm = (data.height_inches as number) * 2.54;
        const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * (data.age as number) + 5);
        const tdee = Math.round(bmr * activity.multiplier);

        data.bmr = bmr;
        data.tdee = tdee;

        nextStep = 'activity_level';
      } else {
        await ctx.reply(`Please enter a number from 1-5.`);
        return;
      }
      break;

    case 'activity_level':
      // Parse calorie phases
      const phases: CaloriePhase[] = [];
      const singleCal = message.match(/^(\d{3,4})$/);

      if (singleCal) {
        phases.push({
          start_day: 1,
          end_day: 75,
          target_calories: parseInt(singleCal[1]),
          label: 'target'
        });
      } else {
        // Try to parse multiple phases
        const phaseMatches = message.matchAll(/(\d{3,4})\s*(?:for|cal)?\s*(?:days?)?\s*(\d+)-(\d+)/gi);
        for (const match of phaseMatches) {
          phases.push({
            start_day: parseInt(match[2]),
            end_day: parseInt(match[3]),
            target_calories: parseInt(match[1]),
            label: `Days ${match[2]}-${match[3]}`
          });
        }
      }

      if (phases.length > 0) {
        data.calorie_phases = phases;
        nextStep = 'calorie_phases';
      } else {
        await ctx.reply(`I didn't understand that. Try "2500" for a single target, or "2920 for days 1-28, 2670 for days 29-49" for phases.`);
        return;
      }
      break;

    case 'calorie_phases':
      // Parse protein target
      if (message.toLowerCase() === 'auto') {
        data.protein_target = Math.round((data.weight as number) * 1);
      } else {
        const protein = parseInt(message);
        if (protein > 0 && protein < 500) {
          data.protein_target = protein;
        } else {
          await ctx.reply(`Please enter a protein target in grams (e.g., "180") or "auto".`);
          return;
        }
      }
      nextStep = 'protein_target';
      break;

    case 'protein_target':
      // Parse water target
      const water = parseInt(message);
      if (water > 0 && water < 300) {
        data.water_target = water;
        nextStep = 'water_target';
      } else {
        await ctx.reply(`Please enter your water target in ounces (e.g., "128").`);
        return;
      }
      break;

    case 'water_target':
      // Parse book
      const bookMatch = message.match(/^(.+?)(?:,\s*(\d+)\s*pages?)?$/i);
      if (bookMatch) {
        const book: Book = {
          title: bookMatch[1].trim(),
          total_pages: bookMatch[2] ? parseInt(bookMatch[2]) : null,
          current_page: 0,
          started_day: 1,
          finished_day: null
        };
        data.books = [book];
        nextStep = 'first_book';
      } else {
        await ctx.reply(`Please enter a book title.`);
        return;
      }
      break;

    case 'first_book':
      data.workout_outdoor = message.trim();
      nextStep = 'workout_outdoor';
      break;

    case 'workout_outdoor':
      data.workout_indoor = message.trim();
      nextStep = 'workout_indoor';
      break;

    case 'workout_indoor':
      data.progress_pic_time = message.trim();
      nextStep = 'progress_pic_time';
      break;

    case 'progress_pic_time':
      if (message.toLowerCase() === 'default') {
        data.alert_times = ['19:00', '20:00', '21:00', '22:00'];
      } else {
        // Parse custom times
        const times = message.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi) || [];
        const parsedTimes = times.map(t => {
          const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
          if (!match) return null;
          let hour = parseInt(match[1]);
          const minute = match[2] || '00';
          const period = match[3]?.toLowerCase();
          if (period === 'pm' && hour < 12) hour += 12;
          if (period === 'am' && hour === 12) hour = 0;
          return `${hour.toString().padStart(2, '0')}:${minute}`;
        }).filter(Boolean) as string[];

        data.alert_times = parsedTimes.length > 0 ? parsedTimes : ['19:00', '20:00', '21:00', '22:00'];
      }
      nextStep = 'alert_times';
      break;

    case 'alert_times':
      if (message.toLowerCase() === 'start') {
        // Save program and complete onboarding
        await storage.updateUserProgram(user.id, {
          height: data.height_inches as number,
          weight: data.weight as number,
          age: data.age as number,
          activityLevel: data.activity_level as string,
          bmr: data.bmr as number,
          tdee: data.tdee as number,
          caloriePhases: data.calorie_phases as CaloriePhase[],
          proteinTarget: data.protein_target as number,
          waterTarget: data.water_target as number,
          books: data.books as Book[],
          workoutOutdoorType: data.workout_outdoor as string,
          workoutIndoorType: data.workout_indoor as string,
          progressPicTime: data.progress_pic_time as string,
          alertTimes: data.alert_times as string[]
        });

        const today = new Date().toISOString().split('T')[0];
        await storage.completeOnboarding(user.telegramId, today);

        // Create day 1 log
        const updatedUser = await storage.getUser(user.telegramId);
        if (updatedUser) {
          await storage.getOrCreateDayLog(updatedUser.id, 1, today);
        }

        nextStep = 'confirm';
      } else {
        await ctx.reply(`Send "START" when you're ready to begin, or let me know if you want to change anything.`);
        return;
      }
      break;

    default:
      nextStep = 'welcome';
  }

  if (nextStep) {
    const updatedUser = await storage.getUser(user.telegramId);
    if (updatedUser) {
      await sendOnboardingMessage(ctx, updatedUser, nextStep);
    }
  }
}

export async function handleMessage(ctx: TextContext | Context, message: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await storage.getUser(telegramId);
  if (!user) {
    await handleStart(ctx);
    return;
  }

  // Handle onboarding
  if (!user.onboardingComplete) {
    await handleOnboarding(ctx as TextContext, user, message);
    return;
  }

  // Get user program
  const program = await storage.getUserProgram(user.id);
  if (!program) {
    await ctx.reply('Something went wrong with your program setup. Please /start again.');
    return;
  }

  // Handle commands
  if (message === '/status') {
    await sendDailyStatus(ctx, user, program);
    return;
  }

  if (message === '/reset') {
    await ctx.reply('Manual reset is disabled. The bot handles resets automatically at 5am if your day is incomplete.');
    return;
  }

  if (message === '/progress') {
    await ctx.reply(`You're on Day ${user.currentDay} of 75. Keep going!`);
    return;
  }

  // Use Claude to understand intent
  const response = await interpretMessage(message, user, program);
  await processIntent(ctx, user, program, response);
}

type Intent = {
  type: 'log_workout' | 'log_food' | 'log_water' | 'log_reading' | 'log_progress_pic' | 'status' | 'conversation' | 'unknown';
  workout_number?: 1 | 2;
  is_outdoor?: boolean;
  duration_mins?: number;
  notes?: string;
  food_description?: string;
  water_amount_oz?: number;
  pages_read?: number;
  response_text: string;
};

async function interpretMessage(message: string, user: User, program: UserProgram): Promise<Intent> {
  const today = new Date().toISOString().split('T')[0];
  const dayLog = await storage.getDayLog(user.id, user.currentDay);

  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);

  const systemPrompt = `You are an accountability partner for 75 Hard. The user is on Day ${user.currentDay}.

Their program:
- Calorie target: ${calorieTarget}
- Protein target: ${program.proteinTarget}g
- Water target: ${program.waterTarget} oz
- Outdoor workout type: ${program.workoutOutdoorType}
- Indoor workout type: ${program.workoutIndoorType}

Today's progress:
- Workout 1 (outdoor): ${dayLog?.workout1?.done ? '✅' : '❌'}
- Workout 2: ${dayLog?.workout2?.done ? '✅' : '❌'}
- Reading: ${dayLog?.reading?.done ? '✅' : '❌'}
- Water: ${dayLog?.water?.done ? '✅' : '❌'}
- Progress pic: ${dayLog?.progressPic?.done ? '✅' : '❌'}
- Calories: ${dayLog?.diet?.calories_consumed || 0} / ${calorieTarget}

Determine the user's intent from their message. Respond with JSON only:
{
  "type": "log_workout" | "log_food" | "log_water" | "log_reading" | "log_progress_pic" | "status" | "conversation",
  "workout_number": 1 or 2 (if workout),
  "is_outdoor": true/false (if workout),
  "duration_mins": number (if workout, default 45),
  "notes": string (if workout),
  "food_description": string (if food - the original description),
  "water_amount_oz": number (if water),
  "pages_read": number (if reading, default 10),
  "response_text": "Your response to the user"
}

For conversation type, be supportive but real. If they're struggling, acknowledge it and encourage them without being preachy. The program is hard enough.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { type: 'unknown', response_text: "I didn't understand that. Try again?" };
  }

  try {
    let jsonStr = content.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    return JSON.parse(jsonStr) as Intent;
  } catch {
    return { type: 'conversation', response_text: content.text };
  }
}

async function processIntent(ctx: Context, user: User, program: UserProgram, intent: Intent): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dayLog = await storage.getOrCreateDayLog(user.id, user.currentDay, today);
  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);

  switch (intent.type) {
    case 'log_workout': {
      const workout = {
        done: true,
        outdoor: intent.is_outdoor || false,
        duration_mins: intent.duration_mins || 45,
        notes: intent.notes || null,
        logged_at: new Date().toISOString()
      };

      if (intent.workout_number === 1) {
        await storage.logWorkout1(user.id, user.currentDay, workout);
      } else {
        await storage.logWorkout2(user.id, user.currentDay, workout);
      }

      await ctx.reply(intent.response_text);
      await checkDayCompletion(ctx, user, program);
      break;
    }

    case 'log_food': {
      if (!intent.food_description) {
        await ctx.reply("I couldn't parse that food entry. Try being more specific.");
        return;
      }

      try {
        const parsed = await parseFoodEntry(intent.food_description);
        const meal = mealFromParsed(parsed, intent.food_description);
        const updatedLog = await storage.addMeal(user.id, user.currentDay, meal);

        const tableText = formatMealTable(parsed);
        const summaryText = formatDailySummary(
          updatedLog?.meals || [],
          calorieTarget,
          program.proteinTarget || 150
        );

        await ctx.reply(tableText + summaryText, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Food parsing error:', e);
        await ctx.reply("I had trouble parsing that. Try describing your food differently.");
      }
      break;
    }

    case 'log_water': {
      const amount = intent.water_amount_oz || program.waterTarget || 128;
      const isDone = amount >= (program.waterTarget || 128);

      await storage.logWater(user.id, user.currentDay, {
        done: isDone,
        amount_oz: amount,
        logged_at: new Date().toISOString()
      });

      await ctx.reply(intent.response_text);
      if (isDone) {
        await checkDayCompletion(ctx, user, program);
      }
      break;
    }

    case 'log_reading': {
      const pages = intent.pages_read || 10;
      const currentBook = program.books?.[0]?.title || 'Unknown';

      await storage.logReading(user.id, user.currentDay, {
        done: true,
        pages,
        book: currentBook,
        logged_at: new Date().toISOString()
      });

      await ctx.reply(intent.response_text);
      await checkDayCompletion(ctx, user, program);
      break;
    }

    case 'status': {
      await sendDailyStatus(ctx, user, program);
      break;
    }

    case 'conversation':
    case 'unknown':
    default: {
      await ctx.reply(intent.response_text);
      break;
    }
  }
}

async function sendDailyStatus(ctx: Context, user: User, program: UserProgram): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dayLog = await storage.getOrCreateDayLog(user.id, user.currentDay, today);
  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);

  const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieTarget);

  const w1 = dayLog.workout1?.done ? '✅' : '⬜';
  const w2 = dayLog.workout2?.done ? '✅' : '⬜';
  const read = dayLog.reading?.done ? '✅' : '⬜';
  const water = dayLog.water?.done ? '✅' : '⬜';
  const pic = dayLog.progressPic?.done ? '✅' : '⬜';
  const diet = status.calorieStatus === 'over' ? '❌' : (dayLog.diet?.calories_consumed || 0) > 0 ? '📊' : '⬜';

  const calsConsumed = dayLog.diet?.calories_consumed || 0;

  let message = `**Day ${user.currentDay} of 75**\n\n`;
  message += `${w1} Workout 1 (outdoor)\n`;
  message += `${w2} Workout 2\n`;
  message += `${read} Read 10 pages\n`;
  message += `${water} Water (${dayLog.water?.amount_oz || 0}/${program.waterTarget} oz)\n`;
  message += `${pic} Progress pic\n`;
  message += `${diet} Diet (${calsConsumed}/${calorieTarget} cal)\n`;

  if (status.complete) {
    message += `\n🎉 **Day complete!** Great work.`;
  } else if (status.missing.length > 0) {
    message += `\n**Still need:** ${status.missing.join(', ')}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

async function checkDayCompletion(ctx: Context, user: User, program: UserProgram): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dayLog = await storage.getDayLog(user.id, user.currentDay);
  if (!dayLog) return;

  const calorieTarget = storage.getCalorieTargetForDay(program.caloriePhases || [], user.currentDay);
  const status = storage.isDayComplete(dayLog, program.waterTarget || 128, calorieTarget);

  if (status.complete && !dayLog.completed) {
    await storage.markDayComplete(user.id, user.currentDay);

    if (user.currentDay === 75) {
      await ctx.reply(`🏆 **YOU DID IT!** 75 Hard complete!\n\nIncredible discipline. You've proven to yourself what you're capable of.`);
    } else {
      await ctx.reply(`✅ **Day ${user.currentDay} complete!**\n\nSee you tomorrow for Day ${user.currentDay + 1}.`);
    }
  }
}

export async function handlePhoto(ctx: PhotoContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await storage.getUser(telegramId);
  if (!user || !user.onboardingComplete) {
    await ctx.reply('Please complete setup first with /start');
    return;
  }

  const program = await storage.getUserProgram(user.id);
  if (!program) return;

  const photo = ctx.message.photo;
  const largestPhoto = photo[photo.length - 1];
  const fileId = largestPhoto.file_id;

  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, user.currentDay, today);

  // Save progress pic
  await storage.logProgressPic(user.id, user.currentDay, {
    done: true,
    file_id: fileId,
    logged_at: new Date().toISOString()
  });

  await storage.saveProgressPic(user.id, user.currentDay, fileId);

  await ctx.reply(`📸 Progress pic logged for Day ${user.currentDay}!`);
  await checkDayCompletion(ctx, user, program);
}
