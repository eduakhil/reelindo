FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY database database
RUN pnpm install --filter @reelindo/api... --no-frozen-lockfile
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @reelindo/api db:generate && pnpm --filter @reelindo/api build
EXPOSE 4000
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "apps/api/instrument.mjs", "apps/api/dist/server.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||4000)+'/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
