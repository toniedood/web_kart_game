# Stage 1: build the browser code (Node is only needed here)
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# Stage 2: the Python server, which also serves the built pages from dist/
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY --from=web /app/dist ./dist
# Render sets $PORT. One worker only: rooms live in this process's memory.
CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000} --ws-per-message-deflate false"]
