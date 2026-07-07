require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { processTrack } = require('./audioProcessor');
const presets = require('./presets');
const db = require('./db');

// ВАЖНО: сюда нужно вставить актуальную ссылку из ngrok
const MINIAPP_URL = 'https://cupped-hesitate-geologic.ngrok-free.dev';

const bot = new Telegraf(process.env.BOT_TOKEN);

const ORIGINAL_DIR = path.join(__dirname, 'tracks', 'original');
const PROCESSED_DIR = path.join(__dirname, 'tracks', 'processed');

bot.start((ctx) => {
  ctx.reply(
    'Привет! Открой приложение или пришли аудиофайл — он сразу попадёт в твою библиотеку.',
    Markup.inlineKeyboard([
      Markup.button.webApp('🎧 Открыть Bass Bot', MINIAPP_URL)
    ])
  );
});

// Функция скачивания файла по file_id
async function downloadTelegramFile(fileId, savePath) {
  const link = await bot.telegram.getFileLink(fileId);
  const response = await axios({
    method: 'GET',
    url: link.href,
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(savePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Временное хранилище: путь к скачанному файлу, ждущему выбора пресета (по chat id)
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
    await ctx.reply('Скачиваю трек...');

    const fileId = fileObj.file_id;
    const originalName = fileObj.file_name || `${fileId}.mp3`;
    const baseName = `${Date.now()}_${originalName}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const savePath = path.join(ORIGINAL_DIR, baseName);

    await downloadTelegramFile(fileId, savePath);

    // Сразу добавляем трек в базу — теперь он появится в Mini App
    const trackId = db.addTrack(baseName, originalName);
    console.log('Трек сохранён в библиотеку:', baseName, 'id=', trackId);

    pendingTracks[ctx.chat.id] = { savePath, baseName };

    const buttons = Object.entries(presets).map(([key, preset]) =>
      Markup.button.callback(preset.name, `preset:${key}`)
    );

    await ctx.reply(
      'Трек добавлен в библиотеку! Открой Mini App, чтобы настроить его гибко, или выбери быстрый пресет ниже:',
      Markup.inlineKeyboard(buttons, { columns: 1 })
    );
  } catch (err) {
    console.error('Ошибка при скачивании файла:', err);
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
    await processTrack(pending.savePath, processedPath, preset);

    await ctx.replyWithAudio({ source: processedPath });
    await ctx.reply(`Готово! Пресет "${preset.name}" применён 🎧`);
  } catch (err) {
    console.error('Ошибка при обработке файла:', err);
    ctx.reply('Что-то пошло не так при обработке файла 😕');
  } finally {
    delete pendingTracks[ctx.chat.id];
  }
});

bot.launch();
console.log('Бот запущен!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
