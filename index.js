require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { processTrack, legacyPresetToBands } = require('./audioProcessor');
const presets = require('./presets');
const db = require('./db');
const config = require('./config');
const logger = require('./logger');

// ВАЖНО: сюда нужно вставить актуальную ссылку из ngrok (или домен после деплоя)
const MINIAPP_URL = 'https://cupped-hesitate-geologic.ngrok-free.dev';

const bot = new Telegraf(process.env.BOT_TOKEN);

const ORIGINAL_DIR = path.join(__dirname, 'tracks', 'original');
const PROCESSED_DIR = path.join(__dirname, 'tracks', 'processed');
[ORIGINAL_DIR, PROCESSED_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

bot.start((ctx) => {
  ctx.reply(
    'Привет! Открой приложение или пришли аудиофайл — он сразу попадёт в твою библиотеку.',
    Markup.inlineKeyboard([Markup.button.webApp('🎧 Открыть Bass Bot', MINIAPP_URL)])
  );
});

async function downloadTelegramFile(fileId, savePath) {
  const link = await bot.telegram.getFileLink(fileId);
  const response = await axios({ method: 'GET', url: link.href, responseType: 'stream' });

  const writer = fs.createWriteStream(savePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function getDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return resolve(null);
      resolve(data.format ? data.format.duration : null);
    });
  });
}

const pendingTracks = {};

bot.on('audio', async (ctx) => {
  await handleIncomingFile(ctx, ctx.message.audio);
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (doc.mime_type && doc.mime_type.startsWith('audio/')) {
    await handleIncomingFile(ctx, doc);
  } else {
    ctx.reply('Это не похоже на аудиофайл 🤔');
  }
});

async function handleIncomingFile(ctx, fileObj) {
  try {
    // ---- Проверка квоты ----
    const tracksCount = db.getAllTracks().length;
    if (tracksCount >= config.MAX_TRACKS) {
      return ctx.reply(
        `Библиотека заполнена (лимит ${config.MAX_TRACKS} треков). Удали что-нибудь в Mini App, прежде чем присылать новое.`
      );
    }

    const sizeMb = (fileObj.file_size || 0) / (1024 * 1024);
    if (sizeMb > config.MAX_FILE_SIZE_MB) {
      return ctx.reply(`Файл слишком большой (${sizeMb.toFixed(1)} МБ). Лимит — ${config.MAX_FILE_SIZE_MB} МБ.`);
    }

    await ctx.reply('Скачиваю трек...');

    const fileId = fileObj.file_id;
    const originalName = fileObj.file_name || `${fileId}.mp3`;
    const baseName = `${Date.now()}_${originalName}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const savePath = path.join(ORIGINAL_DIR, baseName);

    await downloadTelegramFile(fileId, savePath);
    const duration = await getDuration(savePath);
    const stat = fs.statSync(savePath);

    const trackId = db.addTrack(baseName, originalName, { duration, sizeBytes: stat.size });
    logger.info('Трек сохранён в библиотеку', { baseName, trackId });

    pendingTracks[ctx.chat.id] = { savePath, baseName };

    const buttons = Object.entries(presets)
      .filter(([key]) => key !== 'BANDS' && key !== 'getPresetOptions')
      .map(([key, preset]) => Markup.button.callback(preset.name, `preset:${key}`));

    await ctx.reply(
      'Трек добавлен в библиотеку! Открой Mini App, чтобы настроить его гибко, или выбери быстрый пресет ниже:',
      Markup.inlineKeyboard(buttons, { columns: 1 })
    );
  } catch (err) {
    logger.error('Ошибка при скачивании файла', { message: err.message });
    ctx.reply('Что-то пошло не так при скачивании файла 😕');
  }
}

bot.action(/preset:(.+)/, async (ctx) => {
  const presetKey = ctx.match[1];
  const preset = presets[presetKey];
  const pending = pendingTracks[ctx.chat.id];

  if (!preset || !pending) {
    return ctx.answerCbQuery('Что-то пошло не так, попробуй прислать файл заново');
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(`Выбран пресет: ${preset.name}\nОбрабатываю...`);

  try {
    const processedPath = path.join(PROCESSED_DIR, `${presetKey}_${pending.baseName}`);
    await processTrack(pending.savePath, processedPath, {
      bands: preset.bands || legacyPresetToBands(preset),
      targetLufs: preset.targetLufs,
      truePeak: preset.truePeak,
      ...presets.getPresetOptions(preset),
    });

    await ctx.replyWithAudio({ source: processedPath });
    await ctx.reply(`Готово! Пресет "${preset.name}" применён 🎧`);
  } catch (err) {
    logger.error('Ошибка при обработке файла', { message: err.message });
    ctx.reply('Что-то пошло не так при обработке файла 😕');
  } finally {
    delete pendingTracks[ctx.chat.id];
  }
});

bot.launch();
logger.info('Бот запущен!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
