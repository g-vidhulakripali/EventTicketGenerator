FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ARG DATABASE_URL=file:/tmp/build-placeholder.db
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate
RUN npm run build
# Clear the build-time placeholder so runtime uses Render's env var
ENV DATABASE_URL=

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && npm run seed && node dist/src/server.js"]
