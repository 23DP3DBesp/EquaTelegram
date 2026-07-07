const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const execPromise = util.promisify(exec);

// Строим строку EQ-фильтра для баса и (опционально) вокала
function buildEqFilter(preset) {
  const entries = [];

  if (preset.bass) {
    const { sub, low } = preset.bass;
    entries.push(`entry(30,${sub})`);
    entries.push(`entry(60,${sub})`);
    entries.push(`entry(90,${low})`);
    entries.push(`entry(150,${low * 0.5})`);
    entries.push(`entry(300,0)`);
  }

  entries.push(`entry(1000,0)`);

  if (preset.vocalBoost) {
    entries.push(`entry(2500,${preset.vocalBoost})`);
    entries.push(`entry(4000,${preset.vocalBoost * 0.7})`);
  } else {
    entries.push(`entry(3000,0)`);
  }

  entries.push(`entry(8000,0)`);

  return `firequalizer=gain_entry='${entries.join(';')}'`;
}

// Проход 1: анализ громкости
async function analyzeLoudness(inputPath, targetLufs) {
  const cmd = `ffmpeg -i "${inputPath}" -af loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json -f null -`;
  const { stderr } = await execPromise(cmd);
  const jsonMatch = stderr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Не удалось получить данные анализа громкости');
  return JSON.parse(jsonMatch[0]);
}

// Применяем EQ (бас/вокал), если он есть в пресете
function applyEq(inputPath, outputPath, preset) {
  return new Promise((resolve, reject) => {
    if (!preset.bass && !preset.vocalBoost) {
      // Нет EQ-настроек — просто копируем файл дальше без изменений
      fs.copyFileSync(inputPath, outputPath);
      return resolve();
    }

    const eqFilter = buildEqFilter(preset);
    ffmpeg(inputPath)
      .audioFilters(eqFilter)
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// Финальный проход: нормализация громкости + лимитер (защита от клиппинга)
function applyLoudnormAndLimiter(inputPath, outputPath, stats, preset) {
  return new Promise((resolve, reject) => {
    const loudnormFilter =
      `loudnorm=I=${preset.targetLufs}:TP=${preset.truePeak}:LRA=11:` +
      `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
      `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
      `offset=${stats.target_offset}:linear=true:print_format=summary`;

    const limiterFilter = `alimiter=limit=0.97:attack=5:release=50`;

    ffmpeg(inputPath)
      .audioFilters([loudnormFilter, limiterFilter])
      .audioFrequency(44100)
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// Главная функция обработки трека по пресету
async function processTrack(inputPath, outputPath, preset) {
  const tempEqPath = outputPath.replace(/\.mp3$/, '_eq_temp.mp3');

  // 1. Применяем EQ (бас/вокал)
  await applyEq(inputPath, tempEqPath, preset);

  // 2. Анализируем громкость уже обработанного файла
  const stats = await analyzeLoudness(tempEqPath, preset.targetLufs);

  // 3. Финальная нормализация + лимитер
  await applyLoudnormAndLimiter(tempEqPath, outputPath, stats, preset);

  // Удаляем временный файл
  fs.unlinkSync(tempEqPath);
}

module.exports = { processTrack };
