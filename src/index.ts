import 'dotenv/config';
import { createBot, setupWebhook, startPolling } from './services/telegram.js';
import { startAlertCron } from './cron/alerts.js';
import { startResetCron } from './cron/reset.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

async function main() {
  console.log('Starting 75 Hard Bot...');

  const bot = createBot(TOKEN as string);

  // Start cron jobs
  startAlertCron(bot);
  startResetCron(bot);

  if (NODE_ENV === 'production' && WEBHOOK_URL && WEBHOOK_SECRET) {
    // Production: Use webhook
    await setupWebhook(bot, WEBHOOK_URL, WEBHOOK_SECRET);

    // Create webhook handler using native http
    const { createServer } = await import('http');

    const server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        // Verify secret token
        const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
        if (secretHeader !== WEBHOOK_SECRET) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const update = JSON.parse(body);
            await bot.handleUpdate(update);
            res.writeHead(200);
            res.end('OK');
          } catch (error) {
            console.error('Webhook error:', error);
            res.writeHead(500);
            res.end('Error');
          }
        });
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(PORT, () => {
      console.log(`Webhook server running on port ${PORT}`);
    });
  } else {
    // Development: Use polling
    await startPolling(bot);
  }
}

main().catch(console.error);
