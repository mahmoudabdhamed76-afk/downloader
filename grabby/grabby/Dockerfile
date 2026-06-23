# Grabby — نسخة سحابية (Railway / Docker)
FROM node:22-slim

# ffmpeg مطلوب لدمج الجودة العالية وعمل MP3
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp كنسخة Linux مستقلة (مش محتاجة بايثون)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY . .

# Railway بيحقن PORT تلقائيًا؛ السيرفر بيقراه
EXPOSE 8080
CMD ["node", "server.js"]
