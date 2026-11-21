/**
 * Google Drive Financial Archive Sync — Module 16.3
 *
 * Archives structured CSV snapshots (Trial Balance, Invoices, Vendor Bills)
 * into organized `YYYY/YYYY-MM` folders inside the tenant's Google Drive folder
 * using Google Drive REST API v3.
 */

import { EntryType, JournalStatus, type PrismaClient } from '@prisma/client';

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string | null,
): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false${parentClause}`;

  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (searchResp.ok) {
    const searchData = (await searchResp.json()) as {
      files?: Array<{ id: string }>;
    };
    if (searchData.files && searchData.files[0]?.id) {
      return searchData.files[0].id;
    }
  }

  const createResp = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
  );

  if (!createResp.ok) {
    const errText = await createResp.text();
    throw new Error(`Failed to create Google Drive folder "${name}": ${errText}`);
  }

  const created = (await createResp.json()) as { id: string };
  return created.id;
}

async function uploadCsvFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  csvContent: string,
): Promise<string> {
  const boundary = `erp_boundary_${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: 'text/csv',
  });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/csv; charset=UTF-8',
    '',
    csvContent,
    `--${boundary}--`,
  ].join('\r\n');

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to upload "${fileName}" to Google Drive: ${errText}`);
  }

  const data = (await resp.json()) as { id: string };
  return data.id;
}

export async function syncArchiveToGoogleDrive(
  prisma: PrismaClient,
  organizationId: string,
  options: {
    accessToken: string;
    rootFolderId?: string | null;
  },
): Promise<{
  rootFolderId: string;
  monthFolderId: string;
  filesUploaded: number;
  fileNames: string[];
}> {
  const { accessToken } = options;
  const now = new Date();
  const yearStr = String(now.getUTCFullYear());
  const monthStr = `${yearStr}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const dateStamp = now.toISOString().slice(0, 10);

  const rootFolderId =
    options.rootFolderId && options.rootFolderId.trim().length > 0
      ? options.rootFolderId.trim()
      : await findOrCreateFolder(accessToken, 'JBTDA-DWS ERP Archive');

  const yearFolderId = await findOrCreateFolder(
    accessToken,
    yearStr,
    rootFolderId,
  );
  const monthFolderId = await findOrCreateFolder(
    accessToken,
    monthStr,
    yearFolderId,
  );

  // 1. Trial Balance CSV
  const [accounts, lines, invoices, bills] = await Promise.all([
    prisma.account.findMany({
      where: { organizationId, isActive: true },
      orderBy: { code: 'asc' },
    }),
    prisma.journalLine.findMany({
      where: {
        organizationId,
        journalEntry: { status: JournalStatus.POSTED },
      },
      select: { accountId: true, entryType: true, amountCents: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId },
      include: { contact: { select: { name: true } } },
      orderBy: { issueDate: 'desc' },
      take: 500,
    }),
    prisma.bill.findMany({
      where: { organizationId },
      include: { contact: { select: { name: true } } },
      orderBy: { issueDate: 'desc' },
      take: 500,
    }),
  ]);

  const tbSums = new Map<string, { dr: bigint; cr: bigint }>();
  for (const l of lines) {
    const cur = tbSums.get(l.accountId) ?? { dr: 0n, cr: 0n };
    if (l.entryType === EntryType.DEBIT) cur.dr += l.amountCents;
    else cur.cr += l.amountCents;
    tbSums.set(l.accountId, cur);
  }

  const tbCsv = toCsv([
    ['Code', 'Account Name', 'Type', 'Debit (AUD)', 'Credit (AUD)'],
    ...accounts.map((a) => {
      const s = tbSums.get(a.id) ?? { dr: 0n, cr: 0n };
      return [
        a.code,
        a.name,
        a.type,
        (Number(s.dr) / 100).toFixed(2),
        (Number(s.cr) / 100).toFixed(2),
      ];
    }),
  ]);

  const invCsv = toCsv([
    ['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Status', 'Subtotal (AUD)', 'GST (AUD)', 'Total (AUD)', 'Paid (AUD)'],
    ...invoices.map((inv) => [
      inv.invoiceNumber,
      inv.contact.name,
      inv.issueDate.toISOString().slice(0, 10),
      inv.dueDate.toISOString().slice(0, 10),
      inv.status,
      (Number(inv.subtotalCents) / 100).toFixed(2),
      (Number(inv.gstCents) / 100).toFixed(2),
      (Number(inv.totalCents) / 100).toFixed(2),
      (Number(inv.amountPaidCents) / 100).toFixed(2),
    ]),
  ]);

  const billCsv = toCsv([
    ['Reference', 'Supplier', 'Issue Date', 'Due Date', 'Status', 'Subtotal (AUD)', 'GST (AUD)', 'Total (AUD)', 'Paid (AUD)'],
    ...bills.map((b) => [
      b.reference ?? b.id.slice(0, 8),
      b.contact.name,
      b.issueDate.toISOString().slice(0, 10),
      b.dueDate.toISOString().slice(0, 10),
      b.status,
      (Number(b.subtotalCents) / 100).toFixed(2),
      (Number(b.gstCents) / 100).toFixed(2),
      (Number(b.totalCents) / 100).toFixed(2),
      (Number(b.amountPaidCents) / 100).toFixed(2),
    ]),
  ]);

  const fileNames = [
    `Trial_Balance_${dateStamp}.csv`,
    `Customer_Invoices_${dateStamp}.csv`,
    `Vendor_Bills_${dateStamp}.csv`,
  ];

  await uploadCsvFile(accessToken, monthFolderId, fileNames[0]!, tbCsv);
  await uploadCsvFile(accessToken, monthFolderId, fileNames[1]!, invCsv);
  await uploadCsvFile(accessToken, monthFolderId, fileNames[2]!, billCsv);

  return {
    rootFolderId,
    monthFolderId,
    filesUploaded: fileNames.length,
    fileNames,
  };
}
