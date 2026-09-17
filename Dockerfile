# 이 이미지를 돌릴 수 있는 곳이면 어디든 배포된다.
# API, WebSocket, 웹을 전부 한 프로세스에서 서빙한다.
# 대화는 DATABASE_URL 이 가리키는 Postgres 에 저장되므로 디스크가 필요 없다.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY . .
RUN npm ci \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# 음성 메시지를 받아쓰려면 모델이 알아듣는 형식으로 바꿔야 한다.
# 폰이 주는 webm/mp4 는 모델이 받지 않고, 그 변환을 ffmpeg 이 한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/dist/index.js"]
