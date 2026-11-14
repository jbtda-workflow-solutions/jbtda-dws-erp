import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import { runStartupSchemaSync } from '../lib/schema-sync.js';

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
    let raw = process.env['DATABASE_URL'].trim();
    // Strip optional surrounding single or double quotes if entered via UI
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).trim();
    }
    return raw;
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

  // Resolve Cloud SQL Unix socket path or TCP host
  // 1. Explicit INSTANCE_CONNECTION_NAME or CLOUD_SQL_CONNECTION_NAME
  // 2. Explicit DB_HOST or POSTGRES_HOST
  // 3. Dynamic scan of /cloudsql mount directory in Cloud Run
  const instanceConn =
    process.env['INSTANCE_CONNECTION_NAME'] ??
    process.env['CLOUD_SQL_CONNECTION_NAME'];

  const host =
    (instanceConn ? `/cloudsql/${instanceConn}` : undefined) ??
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
  if (!dbUrl) {
    const missing: string[] = [];
    if (!process.env['DB_USER'] && !process.env['POSTGRES_USER']) missing.push('DB_USER');
    if (!process.env['DB_PASSWORD'] && !process.env['DB_PASS'] && !process.env['POSTGRES_PASSWORD']) missing.push('DB_PASSWORD');
    if (!process.env['DB_NAME'] && !process.env['POSTGRES_DB']) missing.push('DB_NAME');
    if (!process.env['INSTANCE_CONNECTION_NAME'] && !process.env['DB_HOST']) missing.push('INSTANCE_CONNECTION_NAME/DB_HOST');

    throw new Error(
      `Database configuration missing: [${missing.join(', ')}]. DATABASE_URL or Cloud SQL connection variables must be configured.`,
    );
  }

  process.env['DATABASE_URL'] = dbUrl;

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });

  // Mask password when logging for diagnostic debugging
  const maskedUrl = dbUrl.replace(/:([^@/]+)@/, ':****@');
  fastify.log.info({ dbUrl: maskedUrl }, 'Connecting to PostgreSQL database');

  await runStartupSchemaSync(prisma, fastify.log);
  await prisma.$connect();
  fastify.log.info('Connected to PostgreSQL database');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});

export default prismaPlugin;

