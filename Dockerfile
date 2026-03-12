# ── Build stage ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools needed by bcrypt (native addon)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --production

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY src/ ./src/
COPY views/ ./views/

# Create directories for volumes
RUN mkdir -p cvs uploads

EXPOSE 3001

CMD ["node", "src/server.js"]
