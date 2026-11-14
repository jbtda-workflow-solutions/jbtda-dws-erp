/**
 * Prisma-Native Schema Self-Healing & Protected System Account Verifier
 *
 * Replaces legacy raw-SQL DDL scripts (`rebuild_all_schema.sql`) and mandatory
 * reset environment variables (`AUTO_SCHEMA_PUSH`, `DB_FORCE_RESET`).
 *
 * Uses `backend/prisma/schema.prisma` as the single canonical source of truth:
 * 1. Runs `npx prisma db push --skip-generate --accept-data-loss` to self-heal
 *    any missing tables, columns, enums, or indexes.
 * 2. Verifies and seeds the 10 Protected System GL Accounts (`1000`–`6000`)
 *    across all organizations.
 */

import { execSync } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ensureOrganizationSystemAccounts } from './system-accounts.js';

export interface SchemaSelfHealResult {
  success: boolean;
  durationMs: number;
  organizationsVerified: number;
  output: string;
}

/**
 * Executes `npx prisma db push --skip-generate --accept-data-loss` against
 * the configured `DATABASE_URL` to keep PostgreSQL aligned with `schema.prisma`.
 */
export function runPrismaDbPush(
  dbUrl: string,
  logger?: FastifyBaseLogger,
): { success: boolean; output: string } {
  try {
    logger?.info(
      'Running Prisma schema self-heal (prisma db push --skip-generate --accept-data-loss)...',
    );
    const stdout = execSync(
      'npx prisma db push --skip-generate --accept-data-loss',
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    logger?.info('Prisma schema self-heal completed successfully.');
    return { success: true, output: stdout.trim() };
  } catch (err: any) {
    const stderr =
      typeof err?.stderr === 'string'
        ? err.stderr
        : err instanceof Error
          ? err.message
          : String(err);
    logger?.warn(
      { err: stderr },
      'Prisma db push reported a warning or non-fatal error during startup self-heal',
    );
    return { success: false, output: stderr.trim() };
  }
}

/**
 * Verifies that every organization in the database has the 10 Protected System
 * GL Accounts (`1000`–`6000`) seeded and properly flagged.
 */
export async function verifyAllOrganizationSystemAccounts(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
): Promise<number> {
  const orgs = await prisma.organization.findMany({
    select: { id: true },
  });
  for (const org of orgs) {
    await ensureOrganizationSystemAccounts(prisma, org.id);
  }
  logger?.info(
    { organizationCount: orgs.length },
    'Protected System GL Accounts (1000–6000) verified across all organizations.',
  );
  return orgs.length;
}

/**
 * Complete Prisma-native schema self-heal & system account verification routine.
 * Called automatically on container startup and available on-demand from `/developer`.
 */
export async function runStartupSchemaSync(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): Promise<SchemaSelfHealResult> {
  const start = Date.now();
  const dbUrl = process.env['DATABASE_URL'] ?? '';

  let pushResult = { success: true, output: 'DATABASE_URL not set' };
  if (dbUrl) {
    pushResult = runPrismaDbPush(dbUrl, logger);
  }

  let organizationsVerified = 0;
  try {
    organizationsVerified = await verifyAllOrganizationSystemAccounts(
      prisma,
      logger,
    );
  } catch (err) {
    logger.warn(
      { err },
      'Could not verify organization system accounts during startup sync',
    );
  }

  return {
    success: pushResult.success,
    durationMs: Date.now() - start,
    organizationsVerified,
    output: pushResult.output,
  };
}
