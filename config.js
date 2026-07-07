require('dotenv').config();

module.exports = {
  MAX_TRACKS: Number(process.env.MAX_TRACKS || 200),
  MAX_FILE_SIZE_MB: Number(process.env.MAX_FILE_SIZE_MB || 25),
  KEEP_PROCESSED_VERSIONS: Number(process.env.KEEP_PROCESSED_VERSIONS || 3),
  PORT: Number(process.env.PORT || 3000),
};
