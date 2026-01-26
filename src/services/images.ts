import sharp from 'sharp';
import { Telegraf } from 'telegraf';
import * as storage from './storage.js';

const GRID_COLS = 10;
const THUMB_SIZE = 150;
const PADDING = 2;

export async function generateProgressGrid(
  bot: Telegraf,
  userId: number
): Promise<Buffer | null> {
  const pics = await storage.getProgressPics(userId);

  if (pics.length === 0) {
    return null;
  }

  // Download all images from Telegram
  const images: { dayNumber: number; buffer: Buffer }[] = [];

  for (const pic of pics) {
    try {
      const file = await bot.telegram.getFile(pic.telegramFileId);
      const fileUrl = `https://api.telegram.org/file/bot${bot.telegram.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      images.push({ dayNumber: pic.dayNumber, buffer });
    } catch (error) {
      console.error(`Failed to download image for day ${pic.dayNumber}:`, error);
    }
  }

  if (images.length === 0) {
    return null;
  }

  // Calculate grid dimensions
  const rows = Math.ceil(images.length / GRID_COLS);
  const gridWidth = GRID_COLS * (THUMB_SIZE + PADDING) + PADDING;
  const gridHeight = rows * (THUMB_SIZE + PADDING) + PADDING;

  // Create thumbnails
  const thumbnails: { dayNumber: number; input: Buffer; left: number; top: number }[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);

    try {
      const thumb = await sharp(img.buffer)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .toBuffer();

      thumbnails.push({
        dayNumber: img.dayNumber,
        input: thumb,
        left: PADDING + col * (THUMB_SIZE + PADDING),
        top: PADDING + row * (THUMB_SIZE + PADDING)
      });
    } catch (error) {
      console.error(`Failed to process image for day ${img.dayNumber}:`, error);
    }
  }

  // Create the grid
  const composites = thumbnails.map(t => ({
    input: t.input,
    left: t.left,
    top: t.top
  }));

  const grid = await sharp({
    create: {
      width: gridWidth,
      height: gridHeight,
      channels: 3,
      background: { r: 30, g: 30, b: 30 }
    }
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return grid;
}

export async function sendProgressGrid(
  bot: Telegraf,
  telegramId: number,
  userId: number
): Promise<boolean> {
  const grid = await generateProgressGrid(bot, userId);

  if (!grid) {
    await bot.telegram.sendMessage(telegramId, "No progress pics to display yet!");
    return false;
  }

  await bot.telegram.sendPhoto(telegramId, { source: grid }, {
    caption: '📸 Your 75 Hard Progress'
  });

  return true;
}
