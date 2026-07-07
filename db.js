const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bassbot.db'));
db.pragma('journal_mode = WAL');

// Создаём таблицы, если их ещё нет
db.exec(`
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tags TEXT DEFAULT '',
    duration REAL,
    size_bytes INTEGER,
    playlist_id INTEGER,
    play_count INTEGER DEFAULT 0,
    last_played_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id)
  );

  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    volume_db REAL NOT NULL,
    gains TEXT NOT NULL,
    category TEXT DEFAULT 'custom',
    options TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    preset_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id),
    FOREIGN KEY (preset_id) REFERENCES presets(id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    preset_name TEXT,
    played_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );

  CREATE TABLE IF NOT EXISTS processed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    preset_label TEXT,
    filename TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );
`);

// Миграции для старых баз (если таблицы уже существовали без новых колонок)
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('tracks', 'tags', "TEXT DEFAULT ''");
ensureColumn('tracks', 'duration', 'REAL');
ensureColumn('tracks', 'size_bytes', 'INTEGER');
ensureColumn('tracks', 'playlist_id', 'INTEGER');
ensureColumn('tracks', 'play_count', 'INTEGER DEFAULT 0');
ensureColumn('tracks', 'last_played_at', 'TEXT');
ensureColumn('presets', 'category', "TEXT DEFAULT 'custom'");
ensureColumn('presets', 'options', "TEXT DEFAULT '{}'");

// ---- Плейлисты ----
function addPlaylist(name) {
  return db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name).lastInsertRowid;
}
function getAllPlaylists() {
  return db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all();
}
function deletePlaylist(id) {
  db.prepare('UPDATE tracks SET playlist_id = NULL WHERE playlist_id = ?').run(id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}
function setTrackPlaylist(trackId, playlistId) {
  db.prepare('UPDATE tracks SET playlist_id = ? WHERE id = ?').run(playlistId || null, trackId);
}

// ---- Треки ----
function addTrack(filename, displayName, extra = {}) {
  const stmt = db.prepare(
    'INSERT INTO tracks (filename, display_name, duration, size_bytes) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(filename, displayName, extra.duration || null, extra.sizeBytes || null);
  return result.lastInsertRowid;
}

function getAllTracks({ search, tag, playlistId, sort } = {}) {
  let query = 'SELECT * FROM tracks WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND display_name LIKE ?';
    params.push(`%${search}%`);
  }
  if (tag) {
    query += ' AND (\',\' || tags || \',\') LIKE ?';
    params.push(`%,${tag},%`);
  }
  if (playlistId) {
    query += ' AND playlist_id = ?';
    params.push(playlistId);
  }

  const sortMap = {
    date: 'created_at DESC',
    name: 'display_name ASC',
    duration: 'duration DESC',
    recent: 'last_played_at DESC',
  };
  query += ` ORDER BY ${sortMap[sort] || sortMap.date}`;

  return db.prepare(query).all(...params);
}

function getTrackById(id) {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
}

function deleteTrack(id) {
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  db.prepare('DELETE FROM history WHERE track_id = ?').run(id);
  db.prepare('DELETE FROM processed_files WHERE track_id = ?').run(id);
}

function setTrackTags(id, tags) {
  db.prepare('UPDATE tracks SET tags = ? WHERE id = ?').run(tags, id);
}

function getAllTags() {
  const rows = db.prepare("SELECT tags FROM tracks WHERE tags != ''").all();
  const set = new Set();
  rows.forEach((r) => r.tags.split(',').forEach((t) => t.trim() && set.add(t.trim())));
  return [...set];
}

function markPlayed(id, presetName) {
  db.prepare(
    'UPDATE tracks SET play_count = play_count + 1, last_played_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(id);
  db.prepare('INSERT INTO history (track_id, preset_name) VALUES (?, ?)').run(id, presetName || null);
}

function getHistory(limit = 30) {
  return db
    .prepare(
      `SELECT history.id, history.played_at, history.preset_name,
              tracks.id AS track_id, tracks.display_name AS track_name
       FROM history JOIN tracks ON tracks.id = history.track_id
       ORDER BY history.played_at DESC LIMIT ?`
    )
    .all(limit);
}

// ---- Пресеты ----
function addPreset(name, volumeDb, gains, category = 'custom', options = {}) {
  const stmt = db.prepare(
    'INSERT INTO presets (name, volume_db, gains, category, options) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, volumeDb, JSON.stringify(gains), category, JSON.stringify(options));
  return result.lastInsertRowid;
}

function getAllPresets() {
  const rows = db.prepare('SELECT * FROM presets ORDER BY created_at DESC').all();
  return rows.map((r) => ({ ...r, gains: JSON.parse(r.gains), options: JSON.parse(r.options || '{}') }));
}

function getPresetById(id) {
  const r = db.prepare('SELECT * FROM presets WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, gains: JSON.parse(r.gains), options: JSON.parse(r.options || '{}') };
}

function deletePreset(id) {
  db.prepare('DELETE FROM presets WHERE id = ?').run(id);
}

// Топ пресетов по числу добавлений в избранное (аналог "community top" в рамках одной библиотеки)
function getTopPresets(limit = 10) {
  return db
    .prepare(
      `SELECT presets.id, presets.name, presets.category, COUNT(favorites.id) AS uses
       FROM presets LEFT JOIN favorites ON favorites.preset_id = presets.id
       GROUP BY presets.id ORDER BY uses DESC, presets.created_at DESC LIMIT ?`
    )
    .all(limit);
}

// ---- Избранное ----
function addFavorite(trackId, presetId) {
  const stmt = db.prepare('INSERT INTO favorites (track_id, preset_id) VALUES (?, ?)');
  const result = stmt.run(trackId, presetId || null);
  return result.lastInsertRowid;
}

function getAllFavorites() {
  return db
    .prepare(
      `SELECT favorites.id AS favorite_id,
           tracks.id AS track_id, tracks.display_name AS track_name, tracks.filename,
           presets.id AS preset_id, presets.name AS preset_name
    FROM favorites
    JOIN tracks ON tracks.id = favorites.track_id
    LEFT JOIN presets ON presets.id = favorites.preset_id
    ORDER BY favorites.created_at DESC`
    )
    .all();
}

function deleteFavorite(id) {
  db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
}

// ---- Обработанные версии (для автоочистки старых копий) ----
function addProcessedFile(trackId, presetLabel, filename) {
  return db
    .prepare('INSERT INTO processed_files (track_id, preset_label, filename) VALUES (?, ?, ?)')
    .run(trackId, presetLabel, filename).lastInsertRowid;
}

function getProcessedFiles(trackId) {
  return db
    .prepare('SELECT * FROM processed_files WHERE track_id = ? ORDER BY created_at DESC')
    .all(trackId);
}

// Оставляем только N последних обработанных версий на трек, остальные записи возвращаем на удаление файлов
function pruneProcessedFiles(trackId, keep = 3) {
  const rows = getProcessedFiles(trackId);
  const toDelete = rows.slice(keep);
  toDelete.forEach((r) => db.prepare('DELETE FROM processed_files WHERE id = ?').run(r.id));
  return toDelete; // caller удаляет сами файлы с диска
}

function getAllProcessedFiles() {
  return db.prepare('SELECT * FROM processed_files ORDER BY created_at DESC').all();
}

module.exports = {
  addPlaylist, getAllPlaylists, deletePlaylist, setTrackPlaylist,
  addTrack, getAllTracks, getTrackById, deleteTrack, setTrackTags, getAllTags,
  markPlayed, getHistory,
  addPreset, getAllPresets, getPresetById, deletePreset, getTopPresets,
  addFavorite, getAllFavorites, deleteFavorite,
  addProcessedFile, getProcessedFiles, pruneProcessedFiles, getAllProcessedFiles,
};
