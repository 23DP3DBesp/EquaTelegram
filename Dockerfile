FROM node:20-bookworm-slim

# ffmpeg нужен для всей обработки звука
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p tracks/original tracks/processed backups logs

EXPOSE 3000

# По умолчанию запускаем сервер Mini App.
# Бот (index.js) запускается вторым процессом — см. docker-compose.yml
CMD ["node", "server.js"]
