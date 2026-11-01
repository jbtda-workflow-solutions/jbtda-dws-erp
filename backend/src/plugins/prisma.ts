import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Checks for Cloud SQL proxy Unix sockets mounted automatically by Cloud Run
 * in the /cloudsql directory.
 */
function getAutoCloudSqlHost(): string | undefined {
  try {
    if (fs.existsSync('/cloudsql')) {
      const entries = fs.readdirSync('/cloudsql');
      const instanceDir = entries.find((e) => e.includes(':')) ?? entries[0];
      if (instanceDir) {
        return `/cloudsql/${instanceDir}`;
      }
    }
  } catch {
    // Ignore filesystem read errors in local environments
  }
  return undefined;
}

/**
 * Resolves the database connection string from environment variables,
 * Secret Manager secrets, and Cloud SQL connections configured in Cloud Run.
 *
 * It checks in order:
 * 1. Unified DATABASE_URL (if set)
 * 2. Cloud SQL connection mounted by Cloud Run (auto-discovered from /cloudsql)
 * 3. Explicit INSTANCE_CONNECTION_NAME or DB_HOST
 * 4. Standard TCP fallback (host:port) for local development
 */
export function resolveDatabaseUrl(): string | undefined {
  if (process.env['DATABASE_URL']) {
    return process.env['DATABASE_URL'];
  }

  const user =
    process.env['DB_USER'] ??
    process.env['POSTGRES_USER'];
  const pass =
    process.env['DB_PASSWORD'] ??
    process.env['DB_PASS'] ??
    process.env['POSTGRES_PASSWORD'];
  const name =
    process.env['DB_NAME'] ??
    process.env['POSTGRES_DB'];

  // 1. Check explicit Instance Connection Name or DB_HOST
  // 2. Or automatically discover socket mounted by Cloud Run under /cloudsql
  const host =
    (process.env['INSTANCE_CONNECTION_NAME']
      ? `/cloudsql/${process.env['INSTANCE_CONNECTION_NAME']}`
      : undefined) ??
    process.env['DB_HOST'] ??
    process.env['POSTGRES_HOST'] ??
    getAutoCloudSqlHost();

  if (!user || !pass || !name || !host) {
    return undefined;
  }

  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(pass);

  // Cloud SQL Unix domain socket path (starts with /cloudsql/ or /)
  if (host.startsWith('/cloudsql/') || host.startsWith('/')) {
    return `postgresql://${encodedUser}:${encodedPass}@localhost/${name}?host=${host}&connection_limit=7&pool_timeout=10`;
  }

  // Cloud SQL Instance Connection Name provided without leading /cloudsql/
  if (host.includes(':')) {
    return `postgresql://${encodedUser}:${encodedPass}@localhost/${name}?host=/cloudsql/${host}&connection_limit=7&pool_timeout=10`;
  }

  // Standard TCP connection (Local development / private IP via VPC)
  const port = process.env['DB_PORT'] ?? '5432';
  return `postgresql://${encodedUser}:${encodedPass}@${host}:${port}/${name}?connection_limit=7&pool_timeout=10`;
}

const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const dbUrl = resolveDatabaseUrl();
  if (dbUrl) {
    process.env['DATABASE_URL'] = dbUrl;
  }

  const prisma = new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });

  if (dbUrl) {
    try {
      await prisma.$connect();
      fastify.log.info('Connected to PostgreSQL database');
    } catch (err) {
      fastify.log.warn({ err }, 'Prisma failed to connect during startup; will retry on queries');
    }
  } else {
    fastify.log.warn(
      'Database connection variables are not set (requires DATABASE_URL or DB_USER, DB_PASSWORD, DB_NAME, DB_HOST). Database queries will fail until configured.',
    );
  }

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});

export default prismaPlugin;

