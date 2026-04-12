FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ENV DATABASE_URL=file:/tmp/build-placeholder.db
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && npm run seed && node dist/src/server.js"]
