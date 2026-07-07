// 10-полосный EQ — те же частоты, что использует Mini App на фронтенде
const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// bands: gain в дБ для каждой частоты из BANDS (по порядку)
// category: 'standard' | 'headphones' | 'car' | 'loudness'
const PRESETS = {
  loud: {
    name: 'Громко (Loud)',
    category: 'standard',
    targetLufs: -8,
    truePeak: -0.3,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  bass_safe: {
    name: 'Бас (безопасный)',
    category: 'standard',
    targetLufs: -9,
    truePeak: -0.5,
    bands: [6, 6, 4, 4, 0, 0, 0, 0, 0, 0],
  },
  bass_extreme: {
    name: 'Бас (тряска)',
    category: 'standard',
    targetLufs: -7,
    truePeak: -0.3,
    bands: [10, 10, 7, 7, 0, 0, 0, 0, 0, 0],
    compressor: true,
  },
  vocal_focus: {
    name: 'Вокал на первом плане',
    category: 'standard',
    targetLufs: -9,
    truePeak: -0.5,
    bands: [3, 3, 2, 2, 0, 0, 2, 1.4, 0, 0],
    deEsser: true,
  },

  // ---- Для наушников vs для колонок машины ----
  headphones: {
    name: '🎧 Для наушников',
    category: 'headphones',
    targetLufs: -11,
    truePeak: -1,
    bands: [4, 3, 2, 1, 0, 0, 1, 2, 2, 1],
    stereoWidth: 1.2, // мягкое расширение стерео, комфортно в наушниках
  },
  car: {
    name: '🚗 Для колонок машины',
    category: 'car',
    targetLufs: -7,
    truePeak: -0.3,
    bands: [9, 9, 6, 4, 0, -1, 0, 1, 1, 0], // больше баса и агрессии, компенсация шума салона
    compressor: true,
  },

  // ---- Нормализация под разные площадки (сравнение громкости) ----
  standard_spotify: {
    name: 'Норма: Spotify (-14 LUFS)',
    category: 'loudness',
    targetLufs: -14,
    truePeak: -1,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  standard_youtube: {
    name: 'Норма: YouTube (-14 LUFS)',
    category: 'loudness',
    targetLufs: -14,
    truePeak: -1,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  standard_club: {
    name: 'Норма: Клубный звук (-6 LUFS)',
    category: 'loudness',
    targetLufs: -6,
    truePeak: -0.2,
    bands: [4, 4, 2, 0, 0, 0, 0, 0, 0, 0],
    compressor: true,
  },
};

// Дефолтные (системные) DSP-опции, если пресет их не переопределяет
const DEFAULT_OPTIONS = {
  compressor: false,
  deEsser: false,
  stereoWidth: 1.0, // 1.0 = без изменений
  fadeInSec: 0,
  fadeOutSec: 0,
  trimSilence: false,
};

function getPresetOptions(preset) {
  return {
    ...DEFAULT_OPTIONS,
    compressor: !!preset.compressor,
    deEsser: !!preset.deEsser,
    stereoWidth: preset.stereoWidth || 1.0,
  };
}

module.exports = PRESETS;
module.exports.BANDS = BANDS;
module.exports.getPresetOptions = getPresetOptions;
