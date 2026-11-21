/**
 * Google Calendar Finance Deadlines Sync — Module 16.4
 *
 * Idempotently syncs open Customer Invoice due dates, Vendor Bill due dates,
 * active Recurring Schedules, and Australian quarterly ATO BAS lodgement dates
 * to a Google Calendar using deterministic event IDs (zero duplicates).
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

function deterministicCalendarEventId(namespace: string, rawId: string): string {
  // Google Calendar event IDs must be 5–1024 chars using base32hex [a-v0-9].
  // Lowercase hex [0-9a-f] is a valid strict subset of base32hex.
  return `erp${createHash('sha256')
    .update(`${namespace}:${rawId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function nextDayIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatAud(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} AUD`;
}

async function upsertAllDayEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  dateIso: string,
  summary: string,
  description: string,
): Promise<void> {
  const payload = {
    id: eventId,
    summary,
    description,
    start: { date: dateIso },
    end: { date: nextDayIso(dateIso) },
  };

  const encodedCal = encodeURIComponent(calendarId);
  const putResp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events/${eventId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (putResp.ok) return;

  if (putResp.status === 404) {
    const postResp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (postResp.ok) return;
    const errText = await postResp.text();
    throw new Error(`Calendar event create failed (${postResp.status}): ${errText}`);
  }

  const errText = await putResp.text();
  throw new Error(`Calendar event update failed (${putResp.status}): ${errText}`);
}

function upcomingAustralianBasDeadlines(referenceDate: Date): Array<{
  key: string;
  dateIso: string;
  label: string;
}> {
  const year = referenceDate.getUTCFullYear();
  const candidates = [
    { key: `bas-${year}-q2`, dateIso: `${year}-02-28`, label: `ATO BAS Q2 (Oct–Dec ${year - 1}) Lodgement Due` },
    { key: `bas-${year}-q3`, dateIso: `${year}-04-28`, label: `ATO BAS Q3 (Jan–Mar ${year}) Lodgement Due` },
    { key: `bas-${year}-q4`, dateIso: `${year}-07-28`, label: `ATO BAS Q4 (Apr–Jun ${year}) Lodgement Due` },
    { key: `bas-${year}-q1`, dateIso: `${year}-10-28`, label: `ATO BAS Q1 (Jul–Sep ${year}) Lodgement Due` },
    { key: `bas-${year + 1}-q2`, dateIso: `${year + 1}-02-28`, label: `ATO BAS Q2 (Oct–Dec ${year}) Lodgement Due` },
  ];
  const todayIso = referenceDate.toISOString().slice(0, 10);
  return candidates.filter((c) => c.dateIso >= todayIso).slice(0, 4);
}

export async function syncDeadlinesToGoogleCalendar(
  prisma: PrismaClient,
  organizationId: string,
  options: {
    accessToken: string;
    calendarId?: string | null;
  },
): Promise<{
  calendarId: string;
  syncedCount: number;
  breakdown: {
    invoices: number;
    bills: number;
    recurring: number;
    bas: number;
  };
}> {
  const calendarId = options.calendarId?.trim() || 'primary';
  const now = new Date();

  const [invoices, bills, schedules] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      },
      include: { contact: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 30,
    }),
    prisma.bill.findMany({
      where: {
        organizationId,
        status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
      },
      include: { contact: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 30,
    }),
    prisma.recurringSchedule.findMany({
      where: { organizationId, isActive: true },
      orderBy: { nextRunDate: 'asc' },
      take: 20,
    }),
  ]);

  const basDeadlines = upcomingAustralianBasDeadlines(now);

  for (const inv of invoices) {
    const remaining = inv.totalCents - inv.amountPaidCents;
    await upsertAllDayEvent(
      options.accessToken,
      calendarId,
      deterministicCalendarEventId(`${organizationId}:inv`, inv.id),
      inv.dueDate.toISOString().slice(0, 10),
      `[AR Due] ${inv.invoiceNumber} — ${inv.contact.name} (${formatAud(remaining)})`,
      `Customer Invoice ${inv.invoiceNumber} due for ${inv.contact.name}. Outstanding balance: ${formatAud(remaining)}.`,
    );
  }

  for (const b of bills) {
    const remaining = b.totalCents - b.amountPaidCents;
    const ref = b.reference ?? b.id.slice(0, 8);
    await upsertAllDayEvent(
      options.accessToken,
      calendarId,
      deterministicCalendarEventId(`${organizationId}:bill`, b.id),
      b.dueDate.toISOString().slice(0, 10),
      `[AP Due] ${ref} — ${b.contact.name} (${formatAud(remaining)})`,
      `Vendor Bill ${ref} due for ${b.contact.name}. Outstanding payable: ${formatAud(remaining)}.`,
    );
  }

  for (const sch of schedules) {
    await upsertAllDayEvent(
      options.accessToken,
      calendarId,
      deterministicCalendarEventId(`${organizationId}:rec`, sch.id),
      sch.nextRunDate.toISOString().slice(0, 10),
      `[Recurring ${sch.scheduleType}] ${sch.name}`,
      `Scheduled ${sch.frequency} ${sch.scheduleType} "${sch.name}" (auto-post: ${sch.autoPost ? 'Yes' : 'Draft'}).`,
    );
  }

  for (const bas of basDeadlines) {
    await upsertAllDayEvent(
      options.accessToken,
      calendarId,
      deterministicCalendarEventId(`${organizationId}:bas`, bas.key),
      bas.dateIso,
      `[ATO BAS] ${bas.label}`,
      `Australian Taxation Office quarterly Business Activity Statement lodgement & payment deadline.`,
    );
  }

  return {
    calendarId,
    syncedCount:
      invoices.length + bills.length + schedules.length + basDeadlines.length,
    breakdown: {
      invoices: invoices.length,
      bills: bills.length,
      recurring: schedules.length,
      bas: basDeadlines.length,
    },
  };
}
