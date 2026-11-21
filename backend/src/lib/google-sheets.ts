/**
 * Google Sheets Live Financial Report Exporter — Module 16.2
 *
 * Exports live PostgreSQL financial statements & schedules into a linked
 * Google Spreadsheet via Google Sheets REST API v4.
 */

import { AccountType, EntryType, JournalStatus, type PrismaClient } from '@prisma/client';

export type GoogleSheetsReportType =
  | 'TRIAL_BALANCE'
  | 'PROFIT_AND_LOSS'
  | 'BALANCE_SHEET'
  | 'AGED_AR'
  | 'AGED_AP'
  | 'GENERAL_LEDGER';

function centsToAudNumber(cents: bigint): number {
  return Number(cents) / 100;
}

function getSheetTabTitle(reportType: GoogleSheetsReportType): string {
  switch (reportType) {
    case 'TRIAL_BALANCE':
      return 'ERP Trial Balance';
    case 'PROFIT_AND_LOSS':
      return 'ERP Profit & Loss';
    case 'BALANCE_SHEET':
      return 'ERP Balance Sheet';
    case 'AGED_AR':
      return 'ERP Aged AR';
    case 'AGED_AP':
      return 'ERP Aged AP';
    case 'GENERAL_LEDGER':
      return 'ERP General Ledger';
  }
}

async function ensureSheetTabExists(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaResp.ok) {
    const errText = await metaResp.text();
    throw new Error(`Unable to access Google Spreadsheet (${metaResp.status}): ${errText}`);
  }

  const meta = (await metaResp.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const exists = (meta.sheets ?? []).some(
    (s) => s.properties?.title === sheetTitle,
  );
  if (exists) return;

  const addResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      }),
    },
  );
  if (!addResp.ok) {
    const errText = await addResp.text();
    throw new Error(`Failed to create sheet tab "${sheetTitle}": ${errText}`);
  }
}

async function writeSheetRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: Array<Array<string | number>>,
): Promise<void> {
  const encodedRange = encodeURIComponent(`'${sheetTitle}'!A:Z`);
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  const updateRange = encodeURIComponent(`'${sheetTitle}'!A1`);
  const updateResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${updateRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    },
  );

  if (!updateResp.ok) {
    const errText = await updateResp.text();
    throw new Error(`Failed to write rows to Google Sheets: ${errText}`);
  }
}

export async function exportReportToGoogleSheet(
  prisma: PrismaClient,
  organizationId: string,
  options: {
    accessToken: string;
    spreadsheetId: string;
    reportType: GoogleSheetsReportType;
    startDate?: string;
    endDate?: string;
    asOfDate?: string;
  },
): Promise<{
  spreadsheetId: string;
  sheetTitle: string;
  rowCount: number;
  spreadsheetUrl: string;
}> {
  const { accessToken, spreadsheetId, reportType } = options;
  const nowIso = new Date().toISOString().slice(0, 10);
  const asOf = options.asOfDate ?? options.endDate ?? nowIso;
  const start = options.startDate ?? `${asOf.slice(0, 4)}-07-01`;
  const end = options.endDate ?? asOf;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, abn: true },
  });

  const rows: Array<Array<string | number>> = [
    [`${org?.name ?? 'Organization'} (ABN ${org?.abn ?? ''})`, reportType, `Generated ${new Date().toISOString()}`],
    [],
  ];

  if (reportType === 'TRIAL_BALANCE' || reportType === 'BALANCE_SHEET') {
    const cutoff = new Date(`${asOf}T23:59:59.999Z`);
    const accounts = await prisma.account.findMany({
      where: { organizationId, isActive: true },
      orderBy: { code: 'asc' },
    });
    const lines = await prisma.journalLine.findMany({
      where: {
        organizationId,
        journalEntry: { status: JournalStatus.POSTED, postedAt: { lte: cutoff } },
      },
      select: { accountId: true, entryType: true, amountCents: true },
    });

    const sums = new Map<string, { dr: bigint; cr: bigint }>();
    for (const l of lines) {
      const cur = sums.get(l.accountId) ?? { dr: 0n, cr: 0n };
      if (l.entryType === EntryType.DEBIT) cur.dr += l.amountCents;
      else cur.cr += l.amountCents;
      sums.set(l.accountId, cur);
    }

    if (reportType === 'TRIAL_BALANCE') {
      rows.push(['Code', 'Account Name', 'Type', 'Total Debit (AUD)', 'Total Credit (AUD)', 'Net Balance (AUD)']);
      for (const acc of accounts) {
        const s = sums.get(acc.id) ?? { dr: 0n, cr: 0n };
        if (s.dr === 0n && s.cr === 0n) continue;
        const net = acc.normalBalance === 'DEBIT' ? s.dr - s.cr : s.cr - s.dr;
        rows.push([
          acc.code,
          acc.name,
          acc.type,
          centsToAudNumber(s.dr),
          centsToAudNumber(s.cr),
          centsToAudNumber(net),
        ]);
      }
    } else {
      rows.push(['Section', 'Code', 'Account Name', 'Balance (AUD)']);
      const bsTypes: AccountType[] = [
        AccountType.ASSET,
        AccountType.LIABILITY,
        AccountType.EQUITY,
      ];
      for (const t of bsTypes) {
        for (const acc of accounts.filter((a) => a.type === t)) {
          const s = sums.get(acc.id) ?? { dr: 0n, cr: 0n };
          const net = acc.normalBalance === 'DEBIT' ? s.dr - s.cr : s.cr - s.dr;
          if (net === 0n) continue;
          rows.push([t, acc.code, acc.name, centsToAudNumber(net)]);
        }
      }
    }
  } else if (reportType === 'PROFIT_AND_LOSS') {
    const startDt = new Date(`${start}T00:00:00.000Z`);
    const endDt = new Date(`${end}T23:59:59.999Z`);
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
      },
      orderBy: { code: 'asc' },
    });
    const lines = await prisma.journalLine.findMany({
      where: {
        organizationId,
        journalEntry: {
          status: JournalStatus.POSTED,
          postedAt: { gte: startDt, lte: endDt },
        },
      },
      select: { accountId: true, entryType: true, amountCents: true },
    });

    const sums = new Map<string, bigint>();
    for (const l of lines) {
      const cur = sums.get(l.accountId) ?? 0n;
      sums.set(
        l.accountId,
        l.entryType === EntryType.CREDIT ? cur + l.amountCents : cur - l.amountCents,
      );
    }

    rows.push(['Category', 'Code', 'Account Name', `Amount (${start} to ${end}) AUD`]);
    let totalRev = 0n;
    let totalExp = 0n;
    for (const acc of accounts) {
      const rawCreditMinusDebit = sums.get(acc.id) ?? 0n;
      if (rawCreditMinusDebit === 0n) continue;
      if (acc.type === AccountType.REVENUE) {
        totalRev += rawCreditMinusDebit;
        rows.push(['REVENUE', acc.code, acc.name, centsToAudNumber(rawCreditMinusDebit)]);
      } else {
        const expVal = -rawCreditMinusDebit;
        totalExp += expVal;
        rows.push(['EXPENSE', acc.code, acc.name, centsToAudNumber(expVal)]);
      }
    }
    rows.push([]);
    rows.push(['SUMMARY', '', 'Total Revenue', centsToAudNumber(totalRev)]);
    rows.push(['SUMMARY', '', 'Total Expenses', centsToAudNumber(totalExp)]);
    rows.push(['SUMMARY', '', 'Net Operating Profit', centsToAudNumber(totalRev - totalExp)]);
  } else if (reportType === 'AGED_AR') {
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      },
      include: { contact: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    rows.push(['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Status', 'Total (AUD)', 'Paid (AUD)', 'Balance Due (AUD)']);
    for (const inv of invoices) {
      rows.push([
        inv.invoiceNumber,
        inv.contact.name,
        inv.issueDate.toISOString().slice(0, 10),
        inv.dueDate.toISOString().slice(0, 10),
        inv.status,
        centsToAudNumber(inv.totalCents),
        centsToAudNumber(inv.amountPaidCents),
        centsToAudNumber(inv.totalCents - inv.amountPaidCents),
      ]);
    }
  } else if (reportType === 'AGED_AP') {
    const bills = await prisma.bill.findMany({
      where: {
        organizationId,
        status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
      },
      include: { contact: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    rows.push(['Reference', 'Supplier', 'Issue Date', 'Due Date', 'Status', 'Total (AUD)', 'Paid (AUD)', 'Balance Due (AUD)']);
    for (const b of bills) {
      rows.push([
        b.reference ?? b.id.slice(0, 8),
        b.contact.name,
        b.issueDate.toISOString().slice(0, 10),
        b.dueDate.toISOString().slice(0, 10),
        b.status,
        centsToAudNumber(b.totalCents),
        centsToAudNumber(b.amountPaidCents),
        centsToAudNumber(b.totalCents - b.amountPaidCents),
      ]);
    }
  } else {
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId, status: JournalStatus.POSTED },
      include: {
        lines: {
          include: {
            account: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { postedAt: 'desc' },
      take: 250,
    });
    rows.push(['Date', 'Journal #', 'Reference Type', 'Description', 'Account Code', 'Account Name', 'Debit (AUD)', 'Credit (AUD)']);
    for (const entry of entries) {
      for (const l of entry.lines) {
        rows.push([
          entry.postedAt.toISOString().slice(0, 10),
          entry.entryNumber ?? entry.id.slice(0, 8),
          entry.referenceType,
          entry.description,
          l.account.code,
          l.account.name,
          l.entryType === EntryType.DEBIT ? centsToAudNumber(l.amountCents) : 0,
          l.entryType === EntryType.CREDIT ? centsToAudNumber(l.amountCents) : 0,
        ]);
      }
    }
  }

  const sheetTitle = getSheetTabTitle(reportType);
  await ensureSheetTabExists(accessToken, spreadsheetId, sheetTitle);
  await writeSheetRows(accessToken, spreadsheetId, sheetTitle, rows);

  return {
    spreadsheetId,
    sheetTitle,
    rowCount: Math.max(0, rows.length - 3),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
