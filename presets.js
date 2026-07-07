module.exports = {
  loud: {
    name: 'Громко (Loud)',
    targetLufs: -8,      // громче стандарта, но безопасно
    truePeak: -0.3,
    bass: null,
  },
  bass_safe: {
    name: 'Бас (безопасный)',
    targetLufs: -9,
    truePeak: -0.5,
    bass: { sub: 6, low: 4 },   // умеренный буст
  },
  bass_extreme: {
    name: 'Бас (тряска)',
    targetLufs: -7,
    truePeak: -0.3,
    bass: { sub: 10, low: 7 },  // максимальный буст
  },
  vocal_focus: {
    name: 'Вокал на первом плане',
    targetLufs: -9,
    truePeak: -0.5,
    bass: { sub: 3, low: 2 },
    vocalBoost: 2, // немного поднимаем 2-4кГц для разборчивости голоса
  },
};
