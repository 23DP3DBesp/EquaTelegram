const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = 3000;

const ORIGINAL_DIR = path.join(__dirname, 'tracks', 'original');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tracks', express.static(ORIGINAL_DIR));

// ---- Треки ----

// Список треков (из базы данных, не просто из папки)
app.get('/api/tracks', (req, res) => {
  const tracks = db.getAllTracks().map((t) => ({
    id: t.id,
    filename: t.filename,
    displayName: t.display_name,
    url: `/tracks/${encodeURIComponent(t.filename)}`,
  }));
  res.json(tracks);
});

// Удалить трек (и файл, и запись в базе)
app.delete('/api/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const tracks = db.getAllTracks();
  const track = tracks.find((t) => t.id === id);

  if (track) {
    const filePath = path.join(ORIGINAL_DIR, track.filename);
    fs.unlink(filePath, () => {}); // если файла уже нет — не страшно
  }

  db.deleteTrack(id);
  res.json({ success: true });
});

// ---- Пресеты ----

// Список сохранённых пресетов
app.get('/api/presets', (req, res) => {
  res.json(db.getAllPresets());
});

// Сохранить новый пресет
app.post('/api/presets', (req, res) => {
  const { name, volumeDb, gains } = req.body;

  if (!name || typeof volumeDb !== 'number' || !Array.isArray(gains)) {
    return res.status(400).json({ error: 'Некорректные данные пресета' });
  }

  const id = db.addPreset(name, volumeDb, gains);
  res.json({ id, name, volumeDb, gains });
});

// Удалить пресет
app.delete('/api/presets/:id', (req, res) => {
  db.deletePreset(Number(req.params.id));
  res.json({ success: true });
});

// ---- Избранное ----

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

app.listen(PORT, () => {
  console.log(`Mini App сервер запущен на http://localhost:${PORT}`);
});
