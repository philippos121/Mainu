FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production
# Render provides PORT at runtime; 3000 is only the local default.
EXPOSE 3000

CMD ["node", "server.js"]
