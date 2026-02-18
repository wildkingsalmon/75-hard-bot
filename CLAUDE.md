# 75 Hard Telegram Bot

## What This Is

Telegram accountability bot for the 75 Hard challenge. Tracks daily tasks, meals/macros (via FatSecret API), progress photos, and sends push reminders at 7/8/9pm. Uses Claude for conversational coaching and Goggins-style motivation. Resets to Day 1 on any missed day.

## Deployment

**THIS BOT RUNS ON THE VPS. DO NOT start it locally (`npm run dev`, `npm start`, etc.).**

Two instances polling Telegram will fight over updates and cause missed messages.

- **VPS**: `89.167.72.227` (Hetzner CX23, Helsinki)
- **Path**: `/home/ben/75-hard-bot/`
- **Service**: `75-hard-bot.service` (systemd, auto-restart)
- **Mode**: Telegram long-polling (development mode, no webhook)
- **SSH**: `ssh ben@89.167.72.227`
- **Deploy key**: read-only, cloned via `git@github-75hard:wildkingsalmon/75-hard-bot.git`

### Updating the VPS
```bash
# Push changes from Mac
git push origin main

# Then on VPS: pull, rebuild, restart
ssh ben@89.167.72.227 "cd /home/ben/75-hard-bot && git pull && npm run build && sudo systemctl restart 75-hard-bot"
```

### Monitoring
```bash
ssh ben@89.167.72.227 "sudo journalctl -u 75-hard-bot -f"
ssh ben@89.167.72.227 "sudo systemctl status 75-hard-bot"
```

### Other Services on This VPS
The same Hetzner CX23 (`89.167.72.227`) runs multiple services for Ben:

| Service | systemd unit | Path | URL |
|---------|-------------|------|-----|
| **LifeOS API** | `lifeos-api` | `/home/ben/LifeOS/` | https://lifeos.benjaminmorrison.com |
| **LifeOS Agent (Pete)** | `lifeos-agent` | `/home/ben/LifeOS/` | n/a (background agent) |
| **75 Hard Bot** | `75-hard-bot` | `/home/ben/75-hard-bot/` | n/a (Telegram polling) |
| **Ephemeria** | cron (`*/15 * * * *`) | `/home/ben/ephemeria/` | n/a (trading bot) |
| **Vaultwarden** | Docker | `/opt/vaultwarden/` | https://vault.benjaminmorrison.com |

**Reverse proxy**: Nginx + Certbot (Let's Encrypt) for HTTPS.
**Security**: UFW (22/80/443), fail2ban, SSH key-only, root login disabled.

**IMPORTANT**: LifeOS production is at https://lifeos.benjaminmorrison.com (NOT fly.io). The LifeOS repo has legacy fly.io config files that are not used.

## Tech Stack

- **Runtime**: Node.js 18, TypeScript (compiled to `dist/`)
- **Telegram**: Telegraf
- **Database**: PostgreSQL on Neon (Drizzle ORM)
- **AI**: Claude SDK (Anthropic API)
- **Nutrition**: FatSecret API
- **Scheduling**: node-cron (alert reminders, daily reset checks)

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, bot setup, webhook/polling mode |
| `src/db/schema.ts` | Drizzle schema (users, programs, day_logs, progress_pics) |
| `dist/index.js` | Compiled entry point (what systemd runs) |
| `.env` | Secrets (Telegram token, DB URL, API keys) |

## Scripts

```bash
npm run build          # Compile TypeScript
npm run dev            # Local dev with hot reload (DO NOT USE - bot is on VPS)
npm start              # Run compiled JS (DO NOT USE - bot is on VPS)
npm run db:push        # Push schema to Neon DB
npm run db:studio      # Drizzle Studio (DB browser)
```
