FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY api ./api

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "api/src/server.js"]
