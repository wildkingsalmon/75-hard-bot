import Anthropic from '@anthropic-ai/sdk';
import { Context } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import * as storage from '../services/storage.js';
import { parseFoodEntry, formatMealTable, formatDailySummarySimple, mealFromParsed } from '../services/nutrition.js';
import { getQuoteForDay } from '../data/goggins-quotes.js';
import type { OnboardingState, Book, User, UserProgram, DayLog, UserGoal, UserNote } from '../db/schema.js';

const anthropic = new Anthropic();

// Goggins voice system prompt
const GOGGINS_VOICE = `You ARE David Goggins. You speak as him in first person. You've lived through hell - 300 pounds, abusive father, learning disabilities, racism, poverty - and you turned yourself into a Navy SEAL, ultramarathon runner, and the hardest motherfucker on the planet.

HOW YOU TALK:
- Direct. Raw. Real. No corporate bullshit.
- You curse naturally - "motherfucker", "shit", "damn" - but not excessively
- Short sentences. Punchy. Let silence do the work.
- You challenge people. You don't coddle them.
- You acknowledge real effort with respect, not cheerleading

KEY CONCEPTS YOU BELIEVE:
- The 40% rule: When your mind says you're done, you're only 40% done
- Callousing the mind: Suffering builds mental armor
- The accountability mirror: Face the truth about yourself
- No one is coming to save you. It's on YOU.
- Motivation is crap. Discipline is everything.
- Most people are soft and will never know what they're capable of

SIGNATURE PHRASES (use naturally, not forced):
- "Stay hard."
- "Roger that."
- "Who's gonna carry the boats?"
- "They don't know me, son."
- "GOOD." (when something hard happens - it's an opportunity)
- "You're in danger of living a life so comfortable you'll die without realizing your potential."

YOUR RHYTHM:
- Sometimes just acknowledge: "Roger that." and move on
- Sometimes challenge: "That's it? What else you got?"
- Sometimes hit them with truth: "You're only at 40%. Keep pushing."
- Let your responses land. Don't over-explain.

EXAMPLES:
- User logs one workout: "That's one. Where's the other one?"
- User completes the day: "Day 12. Done. 63 more to go. Stay hard."
- User makes excuses: "I don't want to hear that shit. Your mind is lying to you. It wants you soft."
- User says they're struggling: "Good. That's where growth lives. Most people run from this feeling. You're gonna run toward it."
- User asks for motivation: "I don't do motivation. Motivation comes and goes. I do discipline. Now what are you gonna do?"

NEVER SAY:
- "I'm so proud of you!"
- "You're doing amazing sweetie!"
- "It's okay to rest"
- "Don't be too hard on yourself"
- "You've got this!" (empty cheerleading)
- Long paragraphs of motivation nobody asked for

BE REAL:
- Day 3 is different than Day 50
- If they keep failing, acknowledge it and challenge them to dig deeper
- Reference their goals and WHY if you know them
- Vary your responses - don't be a broken record`;

type TextContext = Context<Update> & { message: Message.TextMessage };
type PhotoContext = Context<Update> & { message: Message.PhotoMessage };

// Onboarding steps
const ONBOARDING_STEPS = [
  'welcome',        // Ask diet type
  'diet_type',      // Ask diet mode (confirm/track/deficit)
  'diet_mode',      // Ask targets based on mode (or skip to water for confirm)
  'water_target',   // Ask water
  'first_book',     // Ask book
  'alert_times',    // Ask alert times
  'confirm'         // Show summary, wait for STAY HARD
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

  // Variable intro messages - functional, not preachy
  const intros = [
    `I'm Goggains. Tell me what you've done, I'll track it. I'll hit you up if the day's ending and you're not finished. Ask me anything.`,
    `Name's Goggains. I keep track of your 75 Hard progress - just tell me what you did. I'll check in if you're running out of time. Questions welcome.`,
    `I'm Goggains - your 75 Hard tracker. Log your tasks with me, I'll remind you before midnight if anything's missing. Hit me with questions anytime.`,
    `Goggains here. Send me your completed tasks, I'll track everything. If your day's not done by evening, you'll hear from me. Ask me whatever.`,
  ];
  const intro = intros[Math.floor(Math.random() * intros.length)];

  const messages: Record<OnboardingStep, string> = {
    welcome: `${intro}

75 Hard. No modifications. No excuses. Miss one task, back to Day 1.

Let's set you up. What diet are you following?`,

    diet_type: `How do you want to track it?

**1** - Just confirm I followed it (simple)
**2** - Log meals & see macros
**3** - Track deficit (calories burned vs eaten)

Reply 1, 2, or 3.`,

    diet_mode: (() => {
      const d = state.data as Record<string, unknown>;
      if (d.diet_mode === 'confirm') {
        return `Simple. You'll confirm each day.\n\nWater target? (oz, or "gallon" for 128)`;
      } else if (d.diet_mode === 'track') {
        return `You'll log meals and see the breakdown.\n\nCalorie/macro targets? (e.g., "2000 cal" or "2000 cal, 150g protein")\n\nOr "none" to just track.`;
      } else {
        return `Deficit mode. I'll track: Base + Workout burn - Food = Deficit\n\nWhat's your base calories? (TDEE - what you burn on a rest day)`;
      }
    })(),

    water_target: `What book are you reading?`,

    first_book: `When should I alert you if your day isn't done? Default is 7pm, 8pm, 9pm, 10pm. Say "default" or send your own times.`,

    alert_times: (() => {
      const d = state.data as Record<string, unknown>;
      const book = d.books as Book[] || [];
      const mode = d.diet_mode as string;

      let dietInfo = `${d.diet_type}`;
      if (mode === 'confirm') {
        dietInfo += ` (confirm daily)`;
      } else if (mode === 'track') {
        dietInfo += ` (log meals)`;
        if (d.calorie_target) dietInfo += `\nTarget: ${d.calorie_target} cal`;
        if (d.protein_target) dietInfo += `, ${d.protein_target}g protein`;
      } else if (mode === 'deficit') {
        dietInfo += ` (deficit tracking)`;
        dietInfo += `\nBase: ${d.base_calories} cal`;
      }

      return `**Your setup:**\n` +
        `Diet: ${dietInfo}\n` +
        `Water: ${d.water_target} oz\n` +
        `Book: ${book[0]?.title || 'Not set'}\n` +
        `Alerts: ${(d.alert_times as string[])?.join(', ')}\n\n` +
        `**Daily:**\n` +
        `• Outdoor workout (45+ min)\n` +
        `• Indoor workout (45+ min)\n` +
        `• Follow your diet\n` +
        `• Drink your water\n` +
        `• Read 10 pages\n` +
        `• Progress pic\n\n` +
        `Send "STAY HARD" to begin.`;
    })(),

    confirm: (() => {
      const data = state.data as Record<string, unknown>;
      return `Day 1.\n\n` +
        `• Outdoor workout (45+ min)\n` +
        `• Indoor workout (45+ min)\n` +
        `• Diet: ${data.diet_type}\n` +
        `• Water: ${data.water_target} oz\n` +
        `• Read 10 pages\n` +
        `• Progress pic\n\n` +
        `Tell me what you've done. Stay hard.`;
    })()
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
      data.diet_type = message.trim();
      nextStep = 'diet_type';
      break;

    case 'diet_type': {
      const modeInput = message.trim();
      if (modeInput === '1') {
        data.diet_mode = 'confirm';
      } else if (modeInput === '2') {
        data.diet_mode = 'track';
      } else if (modeInput === '3') {
        data.diet_mode = 'deficit';
      } else {
        await ctx.reply(`Reply 1, 2, or 3.`);
        return;
      }
      nextStep = 'diet_mode';
      break;
    }

    case 'diet_mode': {
      const mode = data.diet_mode as string;

      if (mode === 'confirm') {
        // This message is water target
        const lowerMsg = message.trim().toLowerCase();
        if (lowerMsg === 'gallon') {
          data.water_target = 128;
        } else {
          const water = parseInt(message);
          if (water > 0 && water < 500) {
            data.water_target = water;
          } else {
            await ctx.reply(`Enter ounces (e.g., "128") or "gallon".`);
            return;
          }
        }
        nextStep = 'water_target';
      } else if (mode === 'track') {
        // This message is calorie/macro targets
        const input = message.trim().toLowerCase();
        if (input !== 'none' && input !== 'no') {
          const calMatch = message.match(/(\d+)\s*cal/i);
          const proteinMatch = message.match(/(\d+)\s*g?\s*protein/i);
          const carbMatch = message.match(/(\d+)\s*g?\s*carb/i);
          const fatMatch = message.match(/(\d+)\s*g?\s*fat/i);
          if (calMatch) data.calorie_target = parseInt(calMatch[1]);
          if (proteinMatch) data.protein_target = parseInt(proteinMatch[1]);
          if (carbMatch) data.carb_target = parseInt(carbMatch[1]);
          if (fatMatch) data.fat_target = parseInt(fatMatch[1]);
        }
        // Ask water next
        await storage.updateOnboardingState(user.telegramId, { step: 'diet_mode_water', data });
        await ctx.reply(`Water target? (oz, or "gallon" for 128)`);
        return;
      } else if (mode === 'deficit') {
        // This message is base calories
        const baseCal = parseInt(message);
        if (baseCal > 1000 && baseCal < 6000) {
          data.base_calories = baseCal;
          // Ask water next
          await storage.updateOnboardingState(user.telegramId, { step: 'diet_mode_water', data });
          await ctx.reply(`Water target? (oz, or "gallon" for 128)`);
          return;
        } else {
          await ctx.reply(`Enter base calories (e.g., "2000").`);
          return;
        }
      }
      break;
    }

    case 'diet_mode_water' as OnboardingStep: {
      // Handle water for track/deficit modes
      const lowerMsg = message.trim().toLowerCase();
      if (lowerMsg === 'gallon') {
        data.water_target = 128;
      } else {
        const water = parseInt(message);
        if (water > 0 && water < 500) {
          data.water_target = water;
        } else {
          await ctx.reply(`Enter ounces (e.g., "128") or "gallon".`);
          return;
        }
      }
      nextStep = 'water_target';
      break;
    }

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
        await ctx.reply(`Enter a book title.`);
        return;
      }
      break;

    case 'first_book':
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
      if (message.toLowerCase() === 'stay hard' || message.toLowerCase() === 'start') {
        // Save program and complete onboarding
        await storage.updateUserProgram(user.id, {
          dietType: data.diet_type as string,
          dietMode: data.diet_mode as string,
          baseCalories: data.base_calories as number | undefined,
          calorieTarget: data.calorie_target as number | undefined,
          proteinTarget: data.protein_target as number | undefined,
          carbTarget: data.carb_target as number | undefined,
          fatTarget: data.fat_target as number | undefined,
          waterTarget: data.water_target as number,
          books: data.books as Book[],
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
        await ctx.reply(`Send "STAY HARD" when you're ready.`);
        return;
      }
      break;

    default:
      nextStep = 'welcome';
  }

  if (nextStep) {
    // Save the updated data before moving to next step
    await storage.updateOnboardingState(user.telegramId, { step: nextStep, data });
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
  type: 'log_items' | 'status' | 'conversation' | 'unknown';
  // Multiple items can be logged at once
  log_outdoor_workout?: boolean;
  log_indoor_workout?: boolean;
  log_progress_pic?: boolean;
  log_reading?: boolean;
  log_water?: boolean;
  log_food?: boolean;
  confirm_diet?: boolean; // For 'confirm' mode users
  workout_calories?: number; // For deficit mode
  // Details
  workout_description?: string;
  food_description?: string;
  water_amount_oz?: number;
  pages_read?: number;
  response_text: string;
  // Context extraction - goals/notes learned from conversation
  extracted_context?: {
    goal?: { type: string; description: string };
    why?: string;
    struggle?: string;
    note?: string;
  };
};

async function interpretMessage(message: string, user: User, program: UserProgram): Promise<Intent> {
  const dayLog = await storage.getDayLog(user.id, user.currentDay);
  const context = program.context || { goals: [], why: null, struggles: [], notes: [] };

  // Build context string for personalization
  const goalsStr = context.goals.length > 0
    ? context.goals.map(g => `${g.type}: ${g.description}`).join(', ')
    : 'None set';
  const whyStr = context.why || 'Not shared yet';

  const systemPrompt = `${GOGGINS_VOICE}

CURRENT CONTEXT:
- Day ${user.currentDay} of 75
- Diet: ${program.dietType || 'Not set'}
- Water target: ${program.waterTarget || 128} oz

USER'S GOALS: ${goalsStr}
USER'S WHY: ${whyStr}
${context.struggles.length > 0 ? `STRUGGLES WITH: ${context.struggles.join(', ')}` : ''}

TODAY'S STATUS:
- Outdoor workout: ${dayLog?.outdoorWorkout?.done ? 'Done' : 'Not done'}
- Indoor workout: ${dayLog?.indoorWorkout?.done ? 'Done' : 'Not done'}
- Reading: ${dayLog?.reading?.done ? 'Done' : 'Not done'}
- Water: ${dayLog?.water?.done ? 'Done' : 'Not done'}
- Progress pic: ${dayLog?.progressPic?.done ? 'Done' : 'Not done'}
- Food logged: ${dayLog?.meals?.length || 0} meals

INSTRUCTIONS:
1. Determine what the user is trying to log - they may mention MULTIPLE items at once
2. If they mention goals, reasons for doing 75 Hard, or things they struggle with - extract that info
3. Respond AS GOGGINS - short, blunt, no fluff
4. Reference their personal goals/why when motivating them (if known)

Return JSON:
{
  "type": "log_items" | "status" | "conversation",
  "log_outdoor_workout": true/false (if they mention outdoor workout),
  "log_indoor_workout": true/false (if they mention indoor workout),
  "log_progress_pic": true/false (if they mention progress pic),
  "log_reading": true/false (if they mention reading),
  "log_water": true/false (if they mention water),
  "log_food": true/false (if they mention eating/food),
  "confirm_diet": true/false (if they say they followed their diet - for confirm mode),
  "workout_description": string (if workout - what they did),
  "workout_calories": number (if they mention calories burned in workout),
  "food_description": string (if food - the original description),
  "water_amount_oz": number (if water, or null),
  "pages_read": number (if reading, default 10),
  "response_text": "Your SHORT Goggins-style response",
  "extracted_context": {
    "goal": { "type": "weight|fitness|habit|other", "description": "..." } (if they mention a goal),
    "why": "..." (if they share why they're doing this),
    "struggle": "..." (if they mention something they struggle with),
    "note": "..." (any other useful info to remember about them)
  }
}

Use type "log_items" whenever the user is logging ANY activity. Set the appropriate log_* fields to true.
"confirm_diet" = true when user says things like "followed my diet", "stuck to my diet", "ate clean", etc.
Only include extracted_context fields if the user actually mentions something new to remember.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { type: 'unknown', response_text: "What?" };
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
  await storage.getOrCreateDayLog(user.id, user.currentDay, today);

  // Store any extracted context first
  if (intent.extracted_context) {
    const ec = intent.extracted_context;
    if (ec.goal) {
      await storage.addUserGoal(user.id, {
        type: ec.goal.type,
        description: ec.goal.description,
        mentioned_at: new Date().toISOString()
      });
    }
    if (ec.why) {
      await storage.updateUserWhy(user.id, ec.why);
    }
    if (ec.struggle) {
      await storage.addUserStruggle(user.id, ec.struggle);
    }
    if (ec.note) {
      await storage.addUserNote(user.id, {
        note: ec.note,
        mentioned_at: new Date().toISOString()
      });
    }
  }

  switch (intent.type) {
    case 'log_items': {
      // Handle multiple logged items at once
      if (intent.log_outdoor_workout) {
        await storage.logOutdoorWorkout(user.id, user.currentDay, {
          done: true,
          description: intent.workout_description || null,
          calories_burned: intent.workout_calories || null,
          photo_id: null,
          logged_at: new Date().toISOString()
        });
      }

      if (intent.log_indoor_workout) {
        await storage.logIndoorWorkout(user.id, user.currentDay, {
          done: true,
          description: intent.workout_description || null,
          calories_burned: intent.workout_calories || null,
          photo_id: null,
          logged_at: new Date().toISOString()
        });
      }

      if (intent.confirm_diet) {
        await storage.confirmDiet(user.id, user.currentDay);
      }

      if (intent.log_progress_pic) {
        await storage.logProgressPic(user.id, user.currentDay, {
          done: true,
          file_id: null,
          logged_at: new Date().toISOString()
        });
      }

      if (intent.log_reading) {
        const pages = intent.pages_read || 10;
        const currentBook = program.books?.[0]?.title || 'Unknown';
        await storage.logReading(user.id, user.currentDay, {
          done: true,
          pages,
          book: currentBook,
          logged_at: new Date().toISOString()
        });
      }

      if (intent.log_water && intent.water_amount_oz) {
        const waterTarget = program.waterTarget || 128;
        await storage.addWater(user.id, user.currentDay, intent.water_amount_oz, waterTarget);
      }

      if (intent.log_food && intent.food_description) {
        try {
          const parsed = await parseFoodEntry(intent.food_description, program.dietType || undefined);
          const meal = mealFromParsed(parsed, intent.food_description);
          const updatedLog = await storage.addMeal(user.id, user.currentDay, meal);

          const tableText = formatMealTable(parsed);
          const summaryText = formatDailySummarySimple(updatedLog?.meals || []);
          await ctx.reply(tableText + summaryText, { parse_mode: 'Markdown' });
        } catch (e) {
          console.error('Food parsing error:', e);
          await ctx.reply("Couldn't parse that food. Try again.");
        }
      }

      // Send response and check completion (unless food was logged - that sends its own response)
      if (!intent.log_food) {
        await ctx.reply(intent.response_text);
      }
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

  const waterTarget = program.waterTarget || 128;
  const dietMode = program.dietMode || 'confirm';
  const status = storage.isDayComplete(dayLog, waterTarget, dietMode);

  const outdoor = dayLog.outdoorWorkout?.done ? '✅' : '⬜';
  const indoor = dayLog.indoorWorkout?.done ? '✅' : '⬜';
  const read = dayLog.reading?.done ? '✅' : '⬜';
  const pic = dayLog.progressPic?.done ? '✅' : '⬜';

  // Water progress
  const waterAmount = dayLog.water?.amount_oz || 0;
  const waterDone = waterAmount >= waterTarget;
  const waterIcon = waterDone ? '✅' : '⬜';
  const waterText = `${waterAmount}/${waterTarget} oz`;

  let message = `**Day ${user.currentDay}**\n\n`;
  message += `${outdoor} Outdoor workout\n`;
  message += `${indoor} Indoor workout\n`;
  message += `${read} Reading\n`;
  message += `${waterIcon} Water · ${waterText}\n`;
  message += `${pic} Progress pic\n`;

  // Diet display based on mode
  if (dietMode === 'confirm') {
    const dietIcon = dayLog.dietConfirmed ? '✅' : '⬜';
    message += `${dietIcon} Diet confirmed`;
  } else if (dietMode === 'track') {
    const meals = dayLog.meals?.length || 0;
    const food = meals > 0 ? '✅' : '⬜';
    const cals = dayLog.diet?.calories_consumed || 0;
    const protein = dayLog.diet?.protein || 0;
    message += `${food} Food · ${cals} cal, ${protein}g protein`;
  } else if (dietMode === 'deficit') {
    const meals = dayLog.meals?.length || 0;
    const food = meals > 0 ? '✅' : '⬜';
    const baseCalories = program.baseCalories || 2000;
    const workoutBurn = (dayLog.outdoorWorkout?.calories_burned || 0) + (dayLog.indoorWorkout?.calories_burned || 0);
    const totalBurned = baseCalories + workoutBurn;
    const eaten = dayLog.diet?.calories_consumed || 0;
    const deficit = totalBurned - eaten;

    message += `${food} Food · ${eaten} cal eaten\n\n`;
    message += `**Deficit:**\n`;
    message += `Burned: ${totalBurned.toLocaleString()} (${baseCalories} base`;
    if (workoutBurn > 0) message += ` + ${workoutBurn} workout`;
    message += `)\n`;
    message += `Eaten: ${eaten.toLocaleString()}\n`;
    message += `**${deficit >= 0 ? 'Deficit' : 'Surplus'}: ${Math.abs(deficit).toLocaleString()}** ${deficit >= 0 ? '🔥' : '⚠️'}`;
  }

  if (status.complete) {
    message += `\n\n✓ Day complete.`;
  } else if (status.missing.length > 0) {
    message += `\n\n**Remaining:** ${status.missing.join(', ')}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

async function checkDayCompletion(ctx: Context, user: User, program: UserProgram): Promise<void> {
  const dayLog = await storage.getDayLog(user.id, user.currentDay);
  if (!dayLog) return;

  const status = storage.isDayComplete(dayLog, program.waterTarget || 128, program.dietMode || 'confirm');

  if (status.complete && !dayLog.completed) {
    await storage.markDayComplete(user.id, user.currentDay);

    if (user.currentDay === 75) {
      await ctx.reply(`75 days.\n\nYou did what most people only talk about. You proved to yourself what you're capable of.\n\nStay hard.`);
    } else {
      const remaining = 75 - user.currentDay;
      await ctx.reply(`Day ${user.currentDay}. Done.\n\n${remaining} to go.`);
    }
  }
}

export async function handlePhoto(ctx: PhotoContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await storage.getUser(telegramId);
  if (!user || !user.onboardingComplete) {
    await ctx.reply('Complete setup first. /start');
    return;
  }

  const program = await storage.getUserProgram(user.id);
  if (!program) return;

  const photo = ctx.message.photo;
  const largestPhoto = photo[photo.length - 1];
  const fileId = largestPhoto.file_id;
  const caption = ctx.message.caption?.toLowerCase() || '';

  const today = new Date().toISOString().split('T')[0];
  await storage.getOrCreateDayLog(user.id, user.currentDay, today);

  // Check if caption indicates workout photo
  if (caption.includes('outdoor') || caption.includes('outside')) {
    await storage.logOutdoorWorkout(user.id, user.currentDay, {
      done: true,
      description: ctx.message.caption || null,
      calories_burned: null,
      photo_id: fileId,
      logged_at: new Date().toISOString()
    });
    await ctx.reply('Outdoor workout. Done.');
    await checkDayCompletion(ctx, user, program);
  } else if (caption.includes('indoor') || caption.includes('gym') || caption.includes('inside')) {
    await storage.logIndoorWorkout(user.id, user.currentDay, {
      done: true,
      description: ctx.message.caption || null,
      calories_burned: null,
      photo_id: fileId,
      logged_at: new Date().toISOString()
    });
    await ctx.reply('Indoor workout. Done.');
    await checkDayCompletion(ctx, user, program);
  } else {
    // Default: treat as progress pic
    await storage.logProgressPic(user.id, user.currentDay, {
      done: true,
      file_id: fileId,
      logged_at: new Date().toISOString()
    });
    await storage.saveProgressPic(user.id, user.currentDay, fileId);
    await ctx.reply(`Progress pic. Day ${user.currentDay}.`);
    await checkDayCompletion(ctx, user, program);
  }
}
