/**
 * Fastify server entry point.
 *
 * Plugin registration order:
 *  1. @fastify/cookie  — required by auth session helpers
 *  2. @fastify/helmet  — security headers
 *  3. @fastify/cors    — CORS for development / external origins
 *  4. @fastify/sensible — HTTP error helpers
 *  5. prisma           — PrismaClient decorated on fastify instance
 *  6. auth             — no-op plugin (exports preHandler factories)
 *  7. routes           — API route handlers (/api/v1/*)
 *  8. @fastify/static  — Static React SPA serving & SPA fallback handler
 */

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import organizationRoutes from './routes/organizations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Resolve frontend static directory across container and local layouts
function resolveFrontendDistPath(): string | null {
  const candidates = [
    process.env['FRONTEND_DIST_PATH'],
    '/app/frontend/dist',
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

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
  // Note: crossOriginOpenerPolicy must be 'same-origin-allow-popups' to permit
  // the Google Identity Services popup to postMessage credentials back to the opener.
  // -------------------------------------------------------------------------
  await fastify.register(helmet, {
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
        frameSrc: ["'self'", 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://*.googleapis.com'],
      },
    },
  });

  // -------------------------------------------------------------------------
  // CORS — allow the Vite dev server and external frontend origin if configured
  // In unified production, frontend and backend share the exact same origin.
  // -------------------------------------------------------------------------
  if (!isProduction || process.env['FRONTEND_ORIGIN']) {
    await fastify.register(cors, {
      origin: process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

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
  // Always returns 200 so container stays healthy, with DB connectivity status
  // -------------------------------------------------------------------------
  fastify.get('/healthz', async () => {
    let dbStatus = 'disconnected';
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'unreachable';
    }
    return { status: 'ok', database: dbStatus };
  });

  // -------------------------------------------------------------------------
  // Static React SPA serving & SPA fallback handler
  // -------------------------------------------------------------------------
  const resolvedDistPath = resolveFrontendDistPath();
  if (resolvedDistPath) {
    fastify.log.info(`[JBTDA-DWS-ERP] Serving frontend SPA from: ${resolvedDistPath}`);
    await fastify.register(fastifyStatic, {
      root: resolvedDistPath,
      prefix: '/',
    });

    // Explicit root handler
    fastify.get('/', async (_request, reply) => {
      return reply.sendFile('index.html');
    });

    // Client-side routing fallback handler
    fastify.setNotFoundHandler((request, reply) => {
      // If request was meant for an API route, return standard 404 JSON
      if (request.url.startsWith('/api')) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Route ${request.method}:${request.url} not found`,
        });
      }
      // Otherwise, serve index.html for client-side React Router
      return reply.sendFile('index.html');
    });
  } else {
    fastify.log.warn('[JBTDA-DWS-ERP] Frontend static assets (index.html) not found. Serving API routes only.');
    fastify.get('/', async (_request, reply) => {
      return reply.type('text/html').send(`
        <!doctype html>
        <html>
          <head><title>JBTDA-DWS ERP — API Status</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; max-width: 600px; margin: auto;">
            <h2 style="color: #1e293b;">JBTDA-DWS ERP API is running</h2>
            <p style="color: #64748b;">The Fastify backend API is active, but the compiled frontend SPA assets were not located in this container image.</p>
            <ul>
              <li><strong>Health Check:</strong> <a href="/healthz">/healthz</a></li>
              <li><strong>Auth Config:</strong> <a href="/api/v1/auth/config">/api/v1/auth/config</a></li>
            </ul>
          </body>
        </html>
      `);
    });
  }

  return fastify;
}

async function start() {
  try {
    const fastify = await buildServer();
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    console.error('Fatal error during server startup:', err);
    process.exit(1);
  }
}

void start();

export { buildServer };

