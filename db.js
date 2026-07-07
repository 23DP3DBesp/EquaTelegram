const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bassbot.db'));

// Создаём таблицы, если их ещё нет
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    volume_db REAL NOT NULL,
    gains TEXT NOT NULL,
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
`);

// ---- Треки ----
function addTrack(filename, displayName) {
  const stmt = db.prepare('INSERT INTO tracks (filename, display_name) VALUES (?, ?)');
  const result = stmt.run(filename, displayName);
  return result.lastInsertRowid;
}

function getAllTracks() {
  return db.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all();
}

function deleteTrack(id) {
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
}

// ---- Пресеты ----
function addPreset(name, volumeDb, gains) {
  const stmt = db.prepare('INSERT INTO presets (name, volume_db, gains) VALUES (?, ?, ?)');
  const result = stmt.run(name, volumeDb, JSON.stringify(gains));
  return result.lastInsertRowid;
}

function getAllPresets() {
  const rows = db.prepare('SELECT * FROM presets ORDER BY created_at DESC').all();
  return rows.map((r) => ({ ...r, gains: JSON.parse(r.gains) }));
}

function deletePreset(id) {
  db.prepare('DELETE FROM presets WHERE id = ?').run(id);
}

// ---- Избранное ----
function addFavorite(trackId, presetId) {
  const stmt = db.prepare('INSERT INTO favorites (track_id, preset_id) VALUES (?, ?)');
  const result = stmt.run(trackId, presetId || null);
  return result.lastInsertRowid;
}

function getAllFavorites() {
  return db.prepare(`
    SELECT favorites.id AS favorite_id,
           tracks.id AS track_id, tracks.display_name AS track_name, tracks.filename,
           presets.id AS preset_id, presets.name AS preset_name
    FROM favorites
    JOIN tracks ON tracks.id = favorites.track_id
    LEFT JOIN presets ON presets.id = favorites.preset_id
    ORDER BY favorites.created_at DESC
  `).all();
}

function deleteFavorite(id) {
  db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
}

module.exports = {
  addTrack, getAllTracks, deleteTrack,
  addPreset, getAllPresets, deletePreset,
  addFavorite, getAllFavorites, deleteFavorite,
};
