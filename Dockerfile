# Single container: builds frontend + serves backend with static files
FROM python:3.12-slim AS backend

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

# Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Final image
FROM python:3.12-slim
WORKDIR /app
COPY --from=backend /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=backend /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY backend/ .
COPY --from=frontend /app/dist /app/static

# Serve static frontend + API
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
