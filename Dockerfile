# -----------------------------------------------------------------------------
# Root Dockerfile for GCP Cloud Run Deployment (Unified Monolith)
# Builds the React SPA Frontend and Fastify Backend API into a single image
# -----------------------------------------------------------------------------

# Stage 1: Build Frontend SPA
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend API
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend

# OpenSSL is required by Prisma CLI and engine
RUN apk add --no-cache openssl

# Copy backend dependencies definition
COPY backend/package.json backend/package-lock.json* ./
COPY backend/prisma ./prisma

# Install all dependencies (including devDependencies for build)
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy backend source code and TypeScript configs
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src

# Compile TypeScript to /app/backend/dist
RUN npm run build

# Prune dev dependencies so production image stays minimal
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime (Cloud Run)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV FRONTEND_DIST_PATH=/app/frontend/dist

# Run as non-root user for security
USER node

# Copy backend production artifacts
COPY --chown=node:node --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=backend-builder /app/backend/prisma ./backend/prisma
COPY --chown=node:node --from=backend-builder /app/backend/dist ./backend/dist
COPY --chown=node:node --from=backend-builder /app/backend/package.json ./backend/package.json

# Copy frontend static build for Fastify @fastify/static serving
COPY --chown=node:node --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy allowlisted governance & technical documentation for Module 9 (/api/v1/developer/*)
COPY --chown=node:node AGENTS.md ./AGENTS.md
COPY --chown=node:node AGENT_SPECIFICATION.md ./AGENT_SPECIFICATION.md
COPY --chown=node:node docs ./docs

WORKDIR /app/backend
EXPOSE 8080

CMD ["node", "dist/server.js"]

