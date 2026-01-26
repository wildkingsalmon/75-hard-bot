# 75 Hard Telegram Bot

A Telegram bot that tracks the 75 Hard challenge with full nutrition/macro tracking, powered by Claude SDK.

## Features

- **Onboarding flow**: Personalized program setup (BMR/TDEE calculation, calorie phases, protein targets)
- **Natural language food logging**: "ate 1/2 lb ground beef and rice" → parsed macros
- **Daily task tracking**: Both workouts, reading, water, progress pic
- **Smart alerts**: Hourly reminders if day is incomplete (7pm-10pm)
- **Auto reset**: Incomplete day at 5am = back to Day 1
- **Progress tracking**: Photo grid generation, analytics reports

## Tech Stack

- Node.js + TypeScript
- Claude SDK (Sonnet for chat/food parsing, Haiku for alerts)
- Telegraf (Telegram Bot API)
- PostgreSQL + Drizzle ORM
- node-cron for scheduled jobs

## Setup

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token

### 2. Set up PostgreSQL

Use [Neon](https://neon.tech), [Railway](https://railway.app), or any PostgreSQL instance.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
TELEGRAM_BOT_TOKEN=your_bot_token
DATABASE_URL=postgresql://user:pass@host:5432/database
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Install & Run

```bash
npm install
npm run db:push      # Create database tables
npm run dev          # Start in development (polling mode)
```

### 5. Production Deployment

For production, set:
```
NODE_ENV=production
WEBHOOK_URL=https://your-domain.com/webhook
WEBHOOK_SECRET=random_secret_string
```

Then deploy to Railway, Render, Fly.io, etc.

## Usage

1. Start chat with your bot on Telegram
2. Send `/start` to begin onboarding
3. Answer questions to set up your program
4. Log activities naturally:
   - "did my outdoor run, 50 minutes"
   - "ate 2 eggs, 2 bacon strips, and toast with butter"
   - "finished my water"
   - "read 15 pages of Atomic Habits"
5. Send photos for progress pics
6. Check status with `/status`

## Commands

- `/start` - Begin or restart onboarding
- `/status` - Show today's progress
- `/progress` - View progress report

## Database Schema

- `users` - User profiles, current day, timezone
- `user_programs` - Calorie phases, protein/water targets, books, workout types
- `day_logs` - Daily task completion, meals, macros
- `progress_pics` - Stored Telegram file IDs for progress photos

## Architecture

```
src/
├── agents/
│   ├── chat-handler.ts    # Main conversation (Sonnet)
│   ├── alert-checker.ts   # Alert generation (Haiku)
│   ├── reset-checker.ts   # Day reset logic
│   └── analytics.ts       # Progress reports
├── services/
│   ├── telegram.ts        # Bot setup
│   ├── nutrition.ts       # Food parsing
│   ├── storage.ts         # Database operations
│   └── images.ts          # Progress pic grid
├── db/
│   ├── schema.ts          # Drizzle schema
│   └── index.ts           # DB connection
├── cron/
│   ├── alerts.ts          # Hourly alerts
│   └── reset.ts           # 5am reset check
└── index.ts               # Entry point
```

## The Rules

75 Hard is binary. Every day requires:
1. Two 45-minute workouts (one must be outdoor)
2. Follow your diet (at or under calorie target)
3. Drink your water target
4. Read 10 pages of a book
5. Take a progress pic

Miss anything? Back to Day 1. No exceptions.
