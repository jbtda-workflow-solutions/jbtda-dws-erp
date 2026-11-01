# -----------------------------------------------------------------------------
# Root Dockerfile for GCP Cloud Run Deployment
# Builds the Fastify + TypeScript + Prisma Backend API
# -----------------------------------------------------------------------------

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma CLI and engine
RUN apk add --no-cache openssl

# Copy backend dependencies definition
COPY backend/package.json backend/package-lock.json* ./backend/
COPY backend/prisma ./backend/prisma

WORKDIR /app/backend

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
# Stage 2: Production Runtime (Cloud Run)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app/backend

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Run as non-root user for security
USER node

# Copy production node_modules, generated Prisma client, and compiled dist
COPY --chown=node:node --from=builder /app/backend/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/backend/prisma ./prisma
COPY --chown=node:node --from=builder /app/backend/dist ./dist
COPY --chown=node:node --from=builder /app/backend/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/server.js"]
