/**
 * Centralized Ledger Validation, Posting & Period Lock Enforcement Service — Module 2.
 *
 * Enforces:
 *  1. Accounting Period Lock Date (`organization.lockDate`) — prevents posting,
 *     backdating, or reversing entries on or before the closed period date.
 *  2. Double-entry integer-cent balance invariant (Sum of Debits === Sum of Credits).
 *  3. Verification that all Account and TrackingOption foreign keys belong to the
 *     tenant organization and are currently active (`isActive: true`).
 *  4. Sequential journal numbering (`JNL-0001`) and immutable contra-journal reversals.
 */

import {
  EntryType,
  JournalStatus,
  type Prisma,
  type JournalEntry,
} from '@prisma/client';
import { recordAuditLog } from './audit.js';

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

export interface JournalLineInput {
  accountId: string;
  trackingOptionId?: string | null;
  entryType: EntryType | 'DEBIT' | 'CREDIT';
  amountCents: bigint | number;
  description?: string | null;
}

export interface ValidatedJournalLinesResult {
  lines: Array<{
    accountId: string;
    trackingOptionId: string | null;
    entryType: EntryType;
    amountCents: bigint;
    description: string | null;
  }>;
  totalDebitsCents: bigint;
  totalCreditsCents: bigint;
}

/**
 * Validates a candidate set of double-entry journal lines:
 *  - At least 2 lines required.
 *  - Every line must have a strictly positive integer amount.
 *  - Sum of debits must strictly equal sum of credits.
 *  - Every accountId must exist in the organization and be active.
 *  - Every trackingOptionId (if provided) must exist in the organization and be active.
 */
export async function validateJournalLines(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lines: JournalLineInput[],
): Promise<ValidatedJournalLinesResult> {
  if (!lines || lines.length < 2) {
    throw new Error('A journal entry requires at least two lines (one debit and one credit).');
  }

  let totalDebitsCents = 0n;
  let totalCreditsCents = 0n;
  const accountIds = new Set<string>();
  const trackingOptionIds = new Set<string>();

  const normalizedLines = lines.map((l, idx) => {
    const rawAmount = typeof l.amountCents === 'bigint' ? l.amountCents : BigInt(Math.round(l.amountCents));
    if (rawAmount <= 0n) {
      throw new Error(`Line ${idx + 1}: Amount must be a positive integer in cents (got ${rawAmount.toString()}).`);
    }

    const entryType = l.entryType === 'DEBIT' ? EntryType.DEBIT : EntryType.CREDIT;
    if (entryType === EntryType.DEBIT) {
      totalDebitsCents += rawAmount;
    } else {
      totalCreditsCents += rawAmount;
    }

    accountIds.add(l.accountId);
    if (l.trackingOptionId) {
      trackingOptionIds.add(l.trackingOptionId);
    }

    return {
      accountId: l.accountId,
      trackingOptionId: l.trackingOptionId || null,
      entryType,
      amountCents: rawAmount,
      description: l.description?.trim() || null,
    };
  });

  if (totalDebitsCents !== totalCreditsCents) {
    throw new Error(
      `General Ledger imbalance: Total Debits (${Number(totalDebitsCents)} cents) must equal Total Credits (${Number(totalCreditsCents)} cents). Difference: ${Number(totalDebitsCents - totalCreditsCents)} cents.`,
    );
  }

  // Verify accounts
  const validAccounts = await tx.account.findMany({
    where: {
      organizationId,
      id: { in: Array.from(accountIds) },
      isActive: true,
    },
    select: { id: true, code: true, name: true },
  });

  if (validAccounts.length !== accountIds.size) {
    const foundIds = new Set(validAccounts.map((a) => a.id));
    const missing = Array.from(accountIds).filter((id) => !foundIds.has(id));
    throw new Error(`One or more accounts (${missing.join(', ')}) are invalid, inactive, or do not belong to this organization.`);
  }

  // Verify tracking options if provided
  if (trackingOptionIds.size > 0) {
    const validOptions = await tx.trackingOption.findMany({
      where: {
        organizationId,
        id: { in: Array.from(trackingOptionIds) },
        isActive: true,
      },
      select: { id: true },
    });

    if (validOptions.length !== trackingOptionIds.size) {
      const foundIds = new Set(validOptions.map((o) => o.id));
      const missing = Array.from(trackingOptionIds).filter((id) => !foundIds.has(id));
      throw new Error(`One or more tracking options (${missing.join(', ')}) are invalid, inactive, or do not belong to this organization.`);
    }
  }

  return {
    lines: normalizedLines,
    totalDebitsCents,
    totalCreditsCents,
  };
}

/**
 * Generates the next sequential journal entry number for an organization (e.g. JNL-0001).
 */
export async function getNextJournalEntryNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  prefix = 'JNL',
): Promise<string> {
  const count = await tx.journalEntry.count({
    where: { organizationId },
  });
  const seq = count + 1;
  return `${prefix}-${seq.toString().padStart(4, '0')}`;
}

export interface PostJournalParams {
  organizationId: string;
  actorUserId?: string | null;
  description: string;
  referenceType: string;
  referenceId: string;
  postedAt?: Date;
  status?: JournalStatus;
  lines: JournalLineInput[];
}

/**
 * Centrally validates and records a double-entry journal entry across the monolith.
 */
export async function postJournalEntry(
  tx: Prisma.TransactionClient,
  params: PostJournalParams,
) {
  const {
    organizationId,
    actorUserId,
    description,
    referenceType,
    referenceId,
    postedAt = new Date(),
    status = JournalStatus.POSTED,
    lines,
  } = params;

  // Validate double-entry lines and foreign keys
  const { lines: validatedLines, totalDebitsCents } = await validateJournalLines(
    tx,
    organizationId,
    lines,
  );

  // If posting immediately, verify period lock date
  if (status === JournalStatus.POSTED) {
    const lockCheck = await checkOrganizationLockDate(tx, organizationId, postedAt);
    if (lockCheck.locked) {
      throw new Error(lockCheck.message);
    }
  }

  const entryNumber = await getNextJournalEntryNumber(tx, organizationId, 'JNL');

  const entry = await tx.journalEntry.create({
    data: {
      organizationId,
      entryNumber,
      description,
      referenceType,
      referenceId,
      status,
      postedAt,
      createdByUserId: actorUserId || null,
      approvedByUserId: status === JournalStatus.POSTED ? actorUserId || null : null,
      lines: {
        create: validatedLines.map((l) => ({
          organizationId,
          accountId: l.accountId,
          trackingOptionId: l.trackingOptionId,
          entryType: l.entryType,
          amountCents: l.amountCents,
          description: l.description,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: {
            select: { id: true, code: true, name: true, type: true, normalBalance: true },
          },
          trackingOption: {
            select: { id: true, name: true, trackingCategory: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ entryType: 'asc' }, { amountCents: 'desc' }],
      },
    },
  });

  await recordAuditLog(tx, {
    organizationId,
    actorUserId,
    action: status === JournalStatus.POSTED ? 'JOURNAL_POSTED' : 'JOURNAL_DRAFTED',
    entityType: 'JOURNAL_ENTRY',
    entityId: entry.id,
    summary: `${status === JournalStatus.POSTED ? 'Posted' : 'Drafted'} journal ${entry.entryNumber}: "${description}" ($${(Number(totalDebitsCents) / 100).toFixed(2)})`,
    metadata: {
      entryNumber: entry.entryNumber,
      referenceType,
      referenceId,
      status,
      totalCents: Number(totalDebitsCents),
    },
  });

  return entry;
}

export interface ReverseJournalParams {
  organizationId: string;
  actorUserId?: string | null;
  journalEntryId: string;
  reversalDate?: Date;
  reason?: string;
}

/**
 * 1-Click Journal Reversal:
 * Creates an immutable contra-journal entry with inverted debits/credits,
 * mutually cross-references `reversesEntryId` and `reversedById`, and
 * marks the original entry as `REVERSED`.
 */
export async function reverseJournalEntry(
  tx: Prisma.TransactionClient,
  params: ReverseJournalParams,
) {
  const {
    organizationId,
    actorUserId,
    journalEntryId,
    reversalDate = new Date(),
    reason,
  } = params;

  // Check period lock date for the reversal date
  const lockCheck = await checkOrganizationLockDate(tx, organizationId, reversalDate);
  if (lockCheck.locked) {
    throw new Error(lockCheck.message);
  }

  const original = await tx.journalEntry.findFirst({
    where: { id: journalEntryId, organizationId },
    include: { lines: true },
  });

  if (!original) {
    throw new Error('Journal entry not found in this organization.');
  }

  if (original.status !== JournalStatus.POSTED) {
    throw new Error(`Cannot reverse journal with status "${original.status}". Only POSTED journals can be reversed.`);
  }

  if (original.reversedById) {
    throw new Error(`Journal entry ${original.entryNumber || original.id} has already been reversed.`);
  }

  const nextEntryNumber = await getNextJournalEntryNumber(tx, organizationId, 'REV');
  const reversalDescription = reason?.trim()
    ? `Reversal of ${original.entryNumber || 'Journal'}: ${reason.trim()}`
    : `Reversal of ${original.entryNumber || 'Journal'}: ${original.description}`;

  // Invert lines: DEBIT -> CREDIT, CREDIT -> DEBIT
  const contraLines = original.lines.map((l) => ({
    organizationId,
    accountId: l.accountId,
    trackingOptionId: l.trackingOptionId,
    entryType: l.entryType === EntryType.DEBIT ? EntryType.CREDIT : EntryType.DEBIT,
    amountCents: l.amountCents,
    description: l.description ? `Reversal: ${l.description}` : `Reversal line`,
  }));

  // Create the contra journal
  const contraEntry = await tx.journalEntry.create({
    data: {
      organizationId,
      entryNumber: nextEntryNumber,
      description: reversalDescription,
      referenceType: 'MANUAL_REVERSAL',
      referenceId: original.id,
      status: JournalStatus.POSTED,
      reversesEntryId: original.id,
      postedAt: reversalDate,
      createdByUserId: actorUserId || null,
      approvedByUserId: actorUserId || null,
      lines: {
        create: contraLines,
      },
    },
    include: {
      lines: {
        include: {
          account: {
            select: { id: true, code: true, name: true, type: true, normalBalance: true },
          },
          trackingOption: {
            select: { id: true, name: true, trackingCategory: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ entryType: 'asc' }, { amountCents: 'desc' }],
      },
    },
  });

  // Mark original entry as REVERSED and point to contra entry
  const updatedOriginal = await tx.journalEntry.update({
    where: { id: original.id },
    data: {
      status: JournalStatus.REVERSED,
      reversedById: contraEntry.id,
    },
  });

  await recordAuditLog(tx, {
    organizationId,
    actorUserId,
    action: 'JOURNAL_REVERSED',
    entityType: 'JOURNAL_ENTRY',
    entityId: original.id,
    summary: `Reversed journal ${original.entryNumber} via contra-journal ${contraEntry.entryNumber}`,
    metadata: {
      originalId: original.id,
      originalNumber: original.entryNumber,
      reversalId: contraEntry.id,
      reversalNumber: contraEntry.entryNumber,
      reason: reason || null,
    },
  });

  return {
    original: updatedOriginal,
    reversal: contraEntry,
  };
}

/**
 * Approves a journal entry that is in PENDING_APPROVAL status.
 */
export async function approveJournalEntry(
  tx: Prisma.TransactionClient,
  organizationId: string,
  journalEntryId: string,
  approverUserId: string,
) {
  const entry = await tx.journalEntry.findFirst({
    where: { id: journalEntryId, organizationId },
  });

  if (!entry) {
    throw new Error('Journal entry not found.');
  }

  if (entry.status !== JournalStatus.PENDING_APPROVAL && entry.status !== JournalStatus.DRAFT) {
    throw new Error(`Cannot approve journal with status "${entry.status}".`);
  }

  const lockCheck = await checkOrganizationLockDate(tx, organizationId, entry.postedAt);
  if (lockCheck.locked) {
    throw new Error(lockCheck.message);
  }

  const approved = await tx.journalEntry.update({
    where: { id: entry.id },
    data: {
      status: JournalStatus.POSTED,
      approvedByUserId: approverUserId,
    },
    include: {
      lines: {
        include: {
          account: {
            select: { id: true, code: true, name: true, type: true, normalBalance: true },
          },
          trackingOption: {
            select: { id: true, name: true, trackingCategory: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  await recordAuditLog(tx, {
    organizationId,
    actorUserId: approverUserId,
    action: 'JOURNAL_APPROVED',
    entityType: 'JOURNAL_ENTRY',
    entityId: entry.id,
    summary: `Approved and posted journal ${entry.entryNumber}: "${entry.description}"`,
    metadata: {
      entryNumber: entry.entryNumber,
    },
  });

  return approved;
}
