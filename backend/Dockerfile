# Vilma backend — Express API + UDP syslog listener
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App source
COPY . .

ENV NODE_ENV=production
# 4000 = HTTP API, 5514/udp = syslog listener
EXPOSE 4000
EXPOSE 5514/udp

CMD ["node", "src/index.js"]
