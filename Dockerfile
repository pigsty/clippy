FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

EXPOSE 3000

CMD ["node", "dist/server.js"]
