const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const db = require('./db');
const presets = require('./presets');
const { processTrack, legacyPresetToBands } = require('./audioProcessor');
const config = require('./config');
const logger = require('./logger');

const execFileAsync = promisify(execFile);
const app = express();

const ORIGINAL_DIR = path.join(__dirname, 'tracks', 'original');
const PROCESSED_DIR = path.join(__dirname, 'tracks', 'processed');
const BACKUP_DIR = path.join(__dirname, 'backups');
[ORIGINAL_DIR, PROCESSED_DIR, BACKUP_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function getDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return resolve(null);
      resolve(data.format ? data.format.duration : null);
    });
  });
}

function getPythonCommand() {
  const candidates = [
    process.env.PYTHON,
    process.env.PYTHON_PATH,
    'C:/Python314/python.exe',
    'C:\\Python314\\python.exe',
    'python',
    'python3',
    'py',
  ].filter(Boolean);

  return candidates[0];
}

function downloadFromUrl(url, savePath) {
  const pythonCommand = getPythonCommand();
  const args = ['-m', 'yt_dlp', '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '--output', savePath, '--no-playlist', '--restrict-filenames', '--no-warnings', url];

  if (pythonCommand === 'py') {
    return execFileAsync(pythonCommand, ['-3', ...args], { maxBuffer: 1024 * 1024 * 100 });
  }

  return execFileAsync(pythonCommand, args, { maxBuffer: 1024 * 1024 * 100 });
}

app.use(express.json());
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tracks', express.static(ORIGINAL_DIR));
app.use('/processed', express.static(PROCESSED_DIR));

// =================== ТРЕКИ ===================

app.get('/api/tracks', (req, res) => {
  const { search, tag, playlistId, sort } = req.query;
  const tracks = db
    .getAllTracks({ search, tag, playlistId: playlistId ? Number(playlistId) : null, sort })
    .map((t) => ({
      id: t.id,
      filename: t.filename,
      displayName: t.display_name,
      tags: t.tags ? t.tags.split(',').filter(Boolean) : [],
      duration: t.duration,
      playlistId: t.playlist_id,
      playCount: t.play_count,
      lastPlayedAt: t.last_played_at,
      createdAt: t.created_at,
      url: `/tracks/${encodeURIComponent(t.filename)}`,
    }));
  res.json(tracks);
});

app.post('/api/tracks/import-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Нужна корректная ссылка' });
  }

  const tracksCount = db.getAllTracks().length;
  if (tracksCount >= config.MAX_TRACKS) {
    return res.status(400).json({ error: `Библиотека заполнена (лимит ${config.MAX_TRACKS} треков)` });
  }

  try {
    const safeName = `import_${Date.now()}`;
    const outputTemplate = path.join(ORIGINAL_DIR, `${safeName}.%(ext)s`);
    await downloadFromUrl(url, outputTemplate);

    const files = fs.readdirSync(ORIGINAL_DIR).filter((f) => f.startsWith(`${safeName}.`));
    const downloadedFile = files.find((f) => f.endsWith('.mp3')) || files[0];
    if (!downloadedFile) {
      return res.status(500).json({ error: 'Не удалось получить файл по ссылке' });
    }

    const fullPath = path.join(ORIGINAL_DIR, downloadedFile);
    const duration = await getDuration(fullPath);
    const stat = fs.statSync(fullPath);
    const displayName = path.basename(downloadedFile, path.extname(downloadedFile)).replace(/[_-]+/g, ' ').trim() || 'Импортированный трек';
    const trackId = db.addTrack(downloadedFile, displayName, { duration, sizeBytes: stat.size });

    res.json({ success: true, trackId, filename: downloadedFile, name: displayName });
  } catch (err) {
    logger.error('Ошибка импорта по ссылке', { message: err.message, url });
    res.status(500).json({ error: 'Не удалось скачать трек по ссылке. Проверь ссылку и доступность источника.' });
  }
});

app.delete('/api/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const track = db.getTrackById(id);

  if (track) {
    fs.unlink(path.join(ORIGINAL_DIR, track.filename), () => {});
    db.getProcessedFiles(id).forEach((p) => {
      fs.unlink(path.join(PROCESSED_DIR, p.filename), () => {});
    });
  }

  db.deleteTrack(id);
  res.json({ success: true });
});

app.post('/api/tracks/:id/tags', (req, res) => {
  const { tags } = req.body; // строка "рэп,трасса"
  db.setTrackTags(Number(req.params.id), (tags || '').trim());
  res.json({ success: true });
});

app.post('/api/tracks/:id/playlist', (req, res) => {
  const { playlistId } = req.body;
  db.setTrackPlaylist(Number(req.params.id), playlistId ? Number(playlistId) : null);
  res.json({ success: true });
});

app.post('/api/tracks/:id/play', (req, res) => {
  const { presetName } = req.body;
  db.markPlayed(Number(req.params.id), presetName || null);
  res.json({ success: true });
});

app.get('/api/tags', (req, res) => {
  res.json(db.getAllTags());
});

// =================== ПЛЕЙЛИСТЫ ===================

app.get('/api/playlists', (req, res) => {
  res.json(db.getAllPlaylists());
});

app.post('/api/playlists', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Не указано имя плейлиста' });
  const id = db.addPlaylist(name.trim());
  res.json({ id, name });
});

app.delete('/api/playlists/:id', (req, res) => {
  db.deletePlaylist(Number(req.params.id));
  res.json({ success: true });
});

// =================== ИСТОРИЯ ===================

app.get('/api/history', (req, res) => {
  res.json(db.getHistory(50));
});

// =================== ПРЕСЕТЫ (пользовательские, в БД) ===================

app.get('/api/presets', (req, res) => {
  res.json(db.getAllPresets());
});

app.post('/api/presets', (req, res) => {
  const { name, volumeDb, gains, category, options } = req.body;

  if (!name || typeof volumeDb !== 'number' || !Array.isArray(gains)) {
    return res.status(400).json({ error: 'Некорректные данные пресета' });
  }

  const id = db.addPreset(name, volumeDb, gains, category || 'custom', options || {});
  res.json({ id, name, volumeDb, gains });
});

app.delete('/api/presets/:id', (req, res) => {
  db.deletePreset(Number(req.params.id));
  res.json({ success: true });
});

app.get('/api/presets/top', (req, res) => {
  res.json(db.getTopPresets(10));
});

// Системные (встроенные, неудаляемые) пресеты — из presets.js
app.get('/api/presets/system', (req, res) => {
  const list = Object.entries(presets)
    .filter(([key]) => key !== 'BANDS' && key !== 'getPresetOptions')
    .map(([key, p]) => ({
      key,
      name: p.name,
      category: p.category,
      bands: p.bands || legacyPresetToBands(p),
      targetLufs: p.targetLufs,
      truePeak: p.truePeak,
      options: presets.getPresetOptions(p),
    }));
  res.json(list);
});

// Шеринг пресета: экспорт в переносимый код (base64 JSON), импорт обратно
app.get('/api/presets/:id/export', (req, res) => {
  const preset = db.getPresetById(Number(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Пресет не найден' });
  const payload = { name: preset.name, volumeDb: preset.volume_db, gains: preset.gains, options: preset.options };
  const code = Buffer.from(JSON.stringify(payload)).toString('base64');
  res.json({ code });
});

app.post('/api/presets/import', (req, res) => {
  try {
    const { code } = req.body;
    const payload = JSON.parse(Buffer.from(code, 'base64').toString('utf8'));
    if (!payload.name || !Array.isArray(payload.gains)) {
      return res.status(400).json({ error: 'Неверный код пресета' });
    }
    const id = db.addPreset(payload.name, payload.volumeDb || 0, payload.gains, 'custom', payload.options || {});
    res.json({ id, ...payload });
  } catch (err) {
    res.status(400).json({ error: 'Не удалось разобрать код пресета' });
  }
});

// =================== ИЗБРАННОЕ ===================

app.get('/api/favorites', (req, res) => {
  res.json(db.getAllFavorites());
});

app.post('/api/favorites', (req, res) => {
  const { trackId, presetId } = req.body;
  if (!trackId) {
    return res.status(400).json({ error: 'Не указан trackId' });
  }
  const id = db.addFavorite(trackId, presetId || null);
  res.json({ id });
});

app.delete('/api/favorites/:id', (req, res) => {
  db.deleteFavorite(Number(req.params.id));
  res.json({ success: true });
});

// =================== РЕНДЕР / ЭКСПОРТ ГОТОВОГО ТРЕКА ===================
// Прогоняет оригинал через ffmpeg с текущими настройками EQ + доп. эффектами
// и сохраняет результат как файл, который можно скачать/переслать.

app.post('/api/render', async (req, res) => {
  const {
    trackId,
    bands,
    targetLufs,
    truePeak,
    compressor,
    deEsser,
    stereoWidth,
    fadeInSec,
    fadeOutSec,
    trimSilence,
    preGainDb,
    label,
  } = req.body;

  const track = db.getTrackById(Number(trackId));
  if (!track) return res.status(404).json({ error: 'Трек не найден' });

  const inputPath = path.join(ORIGINAL_DIR, track.filename);
  const safeLabel = (label || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
  const outFilename = `${Date.now()}_${safeLabel}_${track.filename}`;
  const outputPath = path.join(PROCESSED_DIR, outFilename);

  try {
    await processTrack(inputPath, outputPath, {
      bands: bands || new Array(presets.BANDS.length).fill(0),
      targetLufs: targetLufs ?? -10,
      truePeak: truePeak ?? -0.5,
      compressor: !!compressor,
      deEsser: !!deEsser,
      stereoWidth: stereoWidth ?? 1.0,
      fadeInSec: fadeInSec || 0,
      fadeOutSec: fadeOutSec || 0,
      trimSilence: !!trimSilence,
      preGainDb: preGainDb || 0,
    });

    db.addProcessedFile(track.id, safeLabel, outFilename);
    const removed = db.pruneProcessedFiles(track.id, config.KEEP_PROCESSED_VERSIONS);
    removed.forEach((r) => fs.unlink(path.join(PROCESSED_DIR, r.filename), () => {}));

    db.markPlayed(track.id, safeLabel);

    res.json({ url: `/processed/${encodeURIComponent(outFilename)}` });
  } catch (err) {
    logger.error('Ошибка рендера трека', { message: err.message, trackId });
    res.status(500).json({ error: 'Не удалось обработать трек' });
  }
});

app.get('/api/tracks/:id/processed', (req, res) => {
  const list = db.getProcessedFiles(Number(req.params.id)).map((p) => ({
    ...p,
    url: `/processed/${encodeURIComponent(p.filename)}`,
  }));
  res.json(list);
});

// =================== ГРУППОВАЯ ОБРАБОТКА (batch) ===================

app.post('/api/batch-process', async (req, res) => {
  const { trackIds, presetKey } = req.body;
  const preset = presets[presetKey];
  if (!preset || !Array.isArray(trackIds) || trackIds.length === 0) {
    return res.status(400).json({ error: 'Некорректные параметры' });
  }

  const results = [];
  for (const id of trackIds) {
    const track = db.getTrackById(Number(id));
    if (!track) {
      results.push({ trackId: id, error: 'Трек не найден' });
      continue;
    }
    try {
      const inputPath = path.join(ORIGINAL_DIR, track.filename);
      const outFilename = `${Date.now()}_${presetKey}_${track.filename}`;
      const outputPath = path.join(PROCESSED_DIR, outFilename);

      await processTrack(inputPath, outputPath, {
        bands: preset.bands || legacyPresetToBands(preset),
        targetLufs: preset.targetLufs,
        truePeak: preset.truePeak,
        ...presets.getPresetOptions(preset),
      });

      db.addProcessedFile(track.id, presetKey, outFilename);
      const removed = db.pruneProcessedFiles(track.id, config.KEEP_PROCESSED_VERSIONS);
      removed.forEach((r) => fs.unlink(path.join(PROCESSED_DIR, r.filename), () => {}));

      results.push({ trackId: track.id, url: `/processed/${encodeURIComponent(outFilename)}` });
    } catch (err) {
      logger.error('Ошибка batch-обработки', { message: err.message, trackId: id });
      results.push({ trackId: id, error: 'Ошибка обработки' });
    }
  }

  res.json({ results });
});

// =================== ОЧИСТКА СТАРЫХ ВЕРСИЙ / БЭКАП ===================

app.post('/api/cleanup', (req, res) => {
  let removedCount = 0;
  db.getAllTracks().forEach((t) => {
    const removed = db.pruneProcessedFiles(t.id, config.KEEP_PROCESSED_VERSIONS);
    removed.forEach((r) => {
      fs.unlink(path.join(PROCESSED_DIR, r.filename), () => {});
      removedCount += 1;
    });
  });

  // Удаляем файлы-сироты в processed/, на которые нет записи в БД
  const known = new Set(db.getAllProcessedFiles().map((p) => p.filename));
  fs.readdirSync(PROCESSED_DIR).forEach((f) => {
    if (!known.has(f)) {
      fs.unlink(path.join(PROCESSED_DIR, f), () => {});
      removedCount += 1;
    }
  });

  logger.info('Очистка старых обработанных версий', { removedCount });
  res.json({ removed: removedCount });
});

app.post('/api/backup', (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `bassbot-${stamp}.db`);
  try {
    fs.copyFileSync(path.join(__dirname, 'bassbot.db'), dest);
    logger.info('Бэкап базы данных создан', { dest });
    res.json({ success: true, file: path.basename(dest) });
  } catch (err) {
    logger.error('Ошибка бэкапа', { message: err.message });
    res.status(500).json({ error: 'Не удалось создать бэкап' });
  }
});

app.get('/api/quota', (req, res) => {
  const tracksCount = db.getAllTracks().length;
  res.json({
    tracksCount,
    maxTracks: config.MAX_TRACKS,
    maxFileSizeMb: config.MAX_FILE_SIZE_MB,
  });
});

app.listen(config.PORT, () => {
  logger.info(`Mini App сервер запущен на http://localhost:${config.PORT}`);
});
