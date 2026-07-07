const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, 'app.log');

function write(level, message, meta) {
  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const str = JSON.stringify(line);
  fs.appendFile(LOG_FILE, str + '\n', () => {});
  const consoleFn = level === 'error' ? console.error : console.log;
  consoleFn(`[${line.time}] [${level.toUpperCase()}] ${message}`, meta || '');
}

module.exports = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
