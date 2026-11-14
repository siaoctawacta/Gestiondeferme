# AgriPilot API. Build context: ./backend
# Stage 1 installs everything (the Prisma CLI and tsx stay in the image: they run
# `prisma migrate deploy` at start-up and the optional seed command).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` runs `prisma generate` (postinstall), which needs the schema and config first.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Needed by `prisma migrate deploy` and `prisma db seed` (the seed imports ../src/auth/password).
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts /app/package.json /app/tsconfig.json ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations first; the process exits (and compose restarts it) if the database is unreachable.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]
