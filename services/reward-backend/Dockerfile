# Standalone image for the ChainStrike reward-backend (leaderboard API + settlement).
# Self-contained: installs from the package's own lockfile, independent of the
# pnpm workspace. node:sqlite is built into Node 24 (no native module to compile),
# so the leaderboard DB needs nothing beyond a writable volume.
FROM node:24-alpine

WORKDIR /app

# Dependencies. Includes tsx/typescript — the service runs the TS entrypoint directly.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Application source.
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8787
# Leaderboard + settlements persist here; mount a volume at /data so they survive
# container restarts/recreations.
ENV LEADERBOARD_DB_PATH=/data/leaderboard.db
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

# Lightweight liveness probe against the API's /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["npx", "tsx", "src/api/server.ts"]
