const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const execPromise = util.promisify(exec);
const { BANDS } = require('./presets');
const logger = require('./logger');

function ffprobePromise(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

// ---- Строим фильтр графического EQ по 10 полосам ----
function buildEqFilter(bands) {
  const entries = [];
  entries.push(`entry(20,${bands[0] || 0})`);
  BANDS.forEach((freq, i) => entries.push(`entry(${freq},${bands[i] || 0})`));
  entries.push(`entry(20000,${bands[bands.length - 1] || 0})`);
  return `firequalizer=gain_entry='${entries.join(';')}'`;
}

function dbToLinearGain(dbValue) {
  return Math.pow(10, dbValue / 20);
}

function applyPreGain(inputPath, outputPath, preGainDb) {
  return new Promise((resolve, reject) => {
    const gain = Number(preGainDb || 0);
    if (Math.abs(gain) < 0.01) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve();
    }
    ffmpeg(inputPath)
      .audioFilters([`volume=${dbToLinearGain(gain)}`])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function applyEq(inputPath, outputPath, bands) {
  return new Promise((resolve, reject) => {
    const hasEq = bands && bands.some((g) => Math.abs(g) > 0.01);
    if (!hasEq) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve();
    }
    ffmpeg(inputPath)
      .audioFilters(buildEqFilter(bands))
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// ---- Многополосный компрессор (низ/середина/верх обрабатываются раздельно) ----
function applyMultibandCompressor(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .complexFilter(
        [
          '[0:a]asplit=3[a][b][c]',
          '[a]lowpass=f=250,acompressor=threshold=-24dB:ratio=4:attack=20:release=250[low]',
          '[b]bandpass=f=1200:width_type=h:w=3200,acompressor=threshold=-20dB:ratio=3:attack=15:release=200[mid]',
          '[c]highpass=f=4000,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=150[high]',
          '[low][mid][high]amix=inputs=3:normalize=0[out]',
        ],
        'out'
      )
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// ---- De-esser, стерео-расширение, fade in/out, обрезка тишины — один проход ----
async function applyFxChain(inputPath, outputPath, opts) {
  const filters = [];

  if (opts.deEsser) {
    filters.push('deesser=i=0.4:m=0.5:f=0.5:s=o');
  }

  if (opts.stereoWidth && Math.abs(opts.stereoWidth - 1) > 0.01) {
    const m = Math.max(-1, Math.min(2.5, opts.stereoWidth - 1));
    filters.push(`extrastereo=m=${m}:c=0`);
  }

  if (opts.trimSilence) {
    filters.push(
      'silenceremove=start_periods=1:start_silence=0.15:start_threshold=-45dB:' +
        'stop_periods=1:stop_silence=0.3:stop_threshold=-45dB:detection=peak'
    );
  }

  if (opts.fadeInSec > 0) {
    filters.push(`afade=t=in:st=0:d=${opts.fadeInSec}`);
  }

  if (opts.fadeOutSec > 0) {
    const probe = await ffprobePromise(inputPath);
    const duration = probe.format.duration || 0;
    const start = Math.max(0, duration - opts.fadeOutSec);
    filters.push(`afade=t=out:st=${start}:d=${opts.fadeOutSec}`);
  }

  return new Promise((resolve, reject) => {
    if (filters.length === 0) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve();
    }
    ffmpeg(inputPath)
      .audioFilters(filters)
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// ---- Проход анализа громкости ----
async function analyzeLoudness(inputPath, targetLufs) {
  const cmd = `ffmpeg -i "${inputPath}" -af loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json -f null -`;
  const { stderr } = await execPromise(cmd);
  const jsonMatch = stderr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Не удалось получить данные анализа громкости');
  return JSON.parse(jsonMatch[0]);
}

// ---- Финальный проход: нормализация громкости + лимитер (защита от клиппинга) ----
function applyLoudnormAndLimiter(inputPath, outputPath, stats, targetLufs, truePeak) {
  return new Promise((resolve, reject) => {
    const loudnormFilter =
      `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11:` +
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

/**
 * Главная функция обработки трека.
 * config:
 *   bands: number[10]     — усиление по полосам (дБ), см. presets.BANDS
 *   targetLufs: number
 *   truePeak: number
 *   compressor: boolean   — включить многополосный компрессор
 *   deEsser: boolean
 *   stereoWidth: number   — 1.0 = без изменений, >1 шире, <1 уже
 *   fadeInSec, fadeOutSec: number
 *   trimSilence: boolean
 */
async function processTrack(inputPath, outputPath, config) {
  const base = outputPath.replace(/\.mp3$/, '');
  const tempGain = `${base}__0gain.mp3`;
  const tempEq = `${base}__1eq.mp3`;
  const tempComp = `${base}__2comp.mp3`;
  const tempFx = `${base}__3fx.mp3`;
  const temps = [tempGain, tempEq, tempComp, tempFx];

  try {
    await applyPreGain(inputPath, tempGain, config.preGainDb);
    await applyEq(tempGain, tempEq, config.bands || []);

    if (config.compressor) {
      await applyMultibandCompressor(tempEq, tempComp);
    } else {
      fs.copyFileSync(tempEq, tempComp);
    }

    await applyFxChain(tempComp, tempFx, {
      deEsser: !!config.deEsser,
      stereoWidth: config.stereoWidth || 1.0,
      fadeInSec: config.fadeInSec || 0,
      fadeOutSec: config.fadeOutSec || 0,
      trimSilence: !!config.trimSilence,
    });

    const stats = await analyzeLoudness(tempFx, config.targetLufs);
    await applyLoudnormAndLimiter(tempFx, outputPath, stats, config.targetLufs, config.truePeak);
  } catch (err) {
    logger.error('Ошибка обработки трека', { message: err.message, inputPath });
    throw err;
  } finally {
    temps.forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
}

// Совместимость со старым форматом пресетов (bass: {sub, low}, vocalBoost) -> bands[10]
function legacyPresetToBands(preset) {
  const bands = new Array(BANDS.length).fill(0);
  if (preset.bass) {
    const { sub, low } = preset.bass;
    bands[0] = sub; // 32
    bands[1] = sub; // 64
    bands[2] = low; // 125
    bands[3] = low * 0.5; // 250
  }
  if (preset.vocalBoost) {
    bands[6] = preset.vocalBoost; // 2000
    bands[7] = preset.vocalBoost * 0.7; // 4000
  }
  return bands;
}

module.exports = { processTrack, legacyPresetToBands };
