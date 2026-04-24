FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/storage

ENV NODE_ENV=production
CMD ["npm", "start"]
