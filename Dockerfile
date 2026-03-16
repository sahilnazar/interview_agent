FROM node:20-bookworm-slim

WORKDIR /app

# Install only production dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application sources.
COPY src ./src
COPY views ./views
COPY README.md ./README.md

# Runtime folders used by uploads and CV watcher.
RUN mkdir -p /app/uploads /app/cvs /app/cvs/processed

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
