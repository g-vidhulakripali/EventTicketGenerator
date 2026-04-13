FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG DIRECT_URL=${DATABASE_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV DIRECT_URL=${DIRECT_URL}
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/asset ./asset

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node dist/prisma/seed.js && node dist/src/server.js"]
