/**
 * Fastify server entry point.
 *
 * Plugin registration order:
 *  1. @fastify/cookie  — required by auth session helpers
 *  2. @fastify/helmet  — security headers
 *  3. @fastify/cors    — CORS for the React SPA
 *  4. @fastify/sensible — HTTP error helpers
 *  5. prisma           — PrismaClient decorated on fastify instance
 *  6. auth             — no-op plugin (exports preHandler factories)
 *  7. routes           — API route handlers
 */

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import organizationRoutes from './routes/organizations.js';

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function buildServer() {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const fastify = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : {
          level: 'debug',
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          },
        },
  });

  // -------------------------------------------------------------------------
  // Security headers
  // -------------------------------------------------------------------------
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://accounts.google.com'],
        frameSrc: ["'self'", 'https://accounts.google.com'],
      },
    },
  });

  // -------------------------------------------------------------------------
  // CORS — allow the Vite dev server and production frontend origin
  // -------------------------------------------------------------------------
  await fastify.register(cors, {
    origin: process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // -------------------------------------------------------------------------
  // Cookie parser (required for session helpers)
  // -------------------------------------------------------------------------
  if (process.env['SESSION_SECRET']) {
    await fastify.register(cookie, {
      secret: process.env['SESSION_SECRET'],
    });
  } else {
    await fastify.register(cookie);
  }

  // -------------------------------------------------------------------------
  // HTTP error helpers (reply.notFound(), reply.badRequest(), etc.)
  // -------------------------------------------------------------------------
  await fastify.register(sensible);

  // -------------------------------------------------------------------------
  // Prisma client
  // -------------------------------------------------------------------------
  await fastify.register(prismaPlugin);

  // -------------------------------------------------------------------------
  // Auth plugin (decorator + preHandler factories)
  // -------------------------------------------------------------------------
  await fastify.register(authPlugin);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  await fastify.register(authRoutes);
  await fastify.register(organizationRoutes);

  // -------------------------------------------------------------------------
  // Health check (unauthenticated — used by Cloud Run)
  // -------------------------------------------------------------------------
  fastify.get('/healthz', async () => ({ status: 'ok' }));

  return fastify;
}

async function start() {
  const fastify = await buildServer();

  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

void start();

export { buildServer };

