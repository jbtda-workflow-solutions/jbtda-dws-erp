# -----------------------------------------------------------------------------
# Stage 1: Build & Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma CLI and engine
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install all dependencies (including devDependencies for build)
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and build configs
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# Compile TypeScript
RUN npm run build

# Prune dev dependencies for production image
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime (Cloud Run)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Create unprivileged user for security
USER node

# Copy production node_modules and Prisma client
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/server.js"]

