# 이 이미지를 돌릴 수 있는 곳이면 어디든 배포된다.
# API, WebSocket, 웹을 전부 한 프로세스에서 서빙한다.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 는 네이티브 모듈이다. 보통은 미리 빌드된 바이너리를 받아오지만,
# 없는 플랫폼에서도 설치가 되도록 빌드 도구를 함께 둔다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm ci \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

# SQLite 파일은 컨테이너가 아니라 볼륨에 둔다.
# 이 경로에 영구 디스크를 붙이지 않으면 재배포할 때마다 대화가 사라진다.
ENV DATABASE_PATH=/data/fran.sqlite
VOLUME /data

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/dist/index.js"]
