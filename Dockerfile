FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

# Throwaway key for Glama introspection only — no funds, no access
ENV GAME_WALLET_KEY=0x0000000000000000000000000000000000000000000000000000000000000001

ENTRYPOINT ["node", "mcp-server.js"]
