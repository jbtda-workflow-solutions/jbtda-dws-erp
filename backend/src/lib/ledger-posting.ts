/**
 * Centralized Ledger Validation & Period Lock Enforcement Service.
 *
 * Enforces:
 *  1. Accounting Period Lock Date (`organization.lockDate`) — prevents posting,
 *     backdating, or reversing entries on or before the closed period date.
 *  2. Double-entry integer-cent balance invariant (Sum of Debits === Sum of Credits).
 */

import type { Prisma } from '@prisma/client';

export interface LockDateCheckResult {
  locked: boolean;
  lockDateIso?: string;
  message?: string;
}

/**
 * Checks whether a target transaction date falls on or before the
 * organization's configured `lockDate`.
 */
export async function checkOrganizationLockDate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  transactionDate: Date,
): Promise<LockDateCheckResult> {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { lockDate: true },
  });

  if (!org?.lockDate) {
    return { locked: false };
  }

  // Compare YYYY-MM-DD in UTC so time-of-day offsets never cause ambiguity
  const txDay = transactionDate.toISOString().slice(0, 10);
  const lockDay = org.lockDate.toISOString().slice(0, 10);

  if (txDay <= lockDay) {
    return {
      locked: true,
      lockDateIso: lockDay,
      message: `Accounting period is locked on or before ${lockDay}. Cannot post or modify transactions dated ${txDay}.`,
    };
  }

  return { locked: false };
}

