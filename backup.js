// Скрипт для регулярного бэкапа базы данных.
// Запуск вручную: node backup.js
// Запуск по расписанию (например, каждую ночь в 3:00) через системный cron на VPS:
//   0 3 * * * cd /path/to/project && /usr/bin/node backup.js >> logs/backup.log 2>&1

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bassbot.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const KEEP_BACKUPS = 14; // хранить последние N бэкапов

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(BACKUP_DIR, `bassbot-${stamp}.db`);

fs.copyFileSync(DB_PATH, dest);
console.log(`Бэкап создан: ${dest}`);

// Удаляем старые бэкапы, оставляя только последние KEEP_BACKUPS
const files = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => f.endsWith('.db'))
  .map((f) => ({ f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
  .sort((a, b) => b.time - a.time);

files.slice(KEEP_BACKUPS).forEach(({ f }) => {
  fs.unlinkSync(path.join(BACKUP_DIR, f));
  console.log(`Удалён старый бэкап: ${f}`);
});
