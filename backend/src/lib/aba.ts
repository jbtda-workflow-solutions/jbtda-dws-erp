/**
 * Australian APCA (Australian Payments Clearing Association) Cemtex .ABA file generator.
 *
 * Implements strict APCA format:
 *  - 120 characters per record, ending with \r\n
 *  - Record Type 0: Descriptive Record (file header)
 *  - Record Type 1: Detail Record (credit transactions)
 *  - Record Type 7: File Total Record (file summary and hash)
 */

export interface AbaHeader {
  financialInstitution: string; // 3 chars e.g. "CBA", "ANZ", "WBC", "NAB"
  userSupplyingName: string;    // up to 26 chars e.g. company legal or trading name
  userIdentificationNumber: string; // 6 digits APCA User ID e.g. "123456" (default "000000")
  descriptionOfEntries: string; // up to 12 chars e.g. "SUPPLIERS", "PAYROLL"
  processingDate: Date;         // Date of batch payment
}

export interface AbaTransaction {
  bsb: string;                  // 6 digits or XXX-XXX format
  accountNumber: string;        // up to 9 digits
  accountName: string;          // up to 32 chars
  amountCents: bigint | number; // amount in integer cents
  lodgementReference: string;   // up to 18 chars (appears on payee statement)
  traceBsb: string;             // remitter BSB (6 digits or XXX-XXX)
  traceAccountNumber: string;   // remitter Account (up to 9 digits)
  remitterName: string;         // up to 16 chars (company name)
}

/**
 * Standardizes an Australian BSB into "XXX-XXX" format.
 * Returns null if BSB does not contain exactly 6 digits.
 */
export function cleanBsb(bsb?: string | null): string | null {
  if (!bsb) return null;
  const digits = bsb.replace(/\D/g, '');
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
}

/**
 * Cleans account number to alphanumeric, uppercase, max 9 chars.
 */
export function cleanAccountNumber(acc?: string | null): string | null {
  if (!acc) return null;
  const cleaned = acc.replace(/[^0-9a-zA-Z]/g, '').slice(0, 9);
  return cleaned.length > 0 ? cleaned : null;
}

function padRight(str: string, length: number): string {
  if (str.length >= length) return str.slice(0, length);
  return str + ' '.repeat(length - str.length);
}

function padLeft(str: string, length: number, char = ' '): string {
  if (str.length >= length) return str.slice(0, length);
  return char.repeat(length - str.length) + str;
}

function formatBsb(bsb: string): string {
  const cleaned = cleanBsb(bsb);
  if (!cleaned) {
    throw new Error(`Invalid Australian BSB format: "${bsb}". Must be 6 digits.`);
  }
  return cleaned;
}

function formatDateDDMMYY(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear().toString().slice(-2);
  return `${day}${month}${year}`;
}

/**
 * Generates an APCA-compliant 120-character-per-line .ABA file content string.
 */
export function generateAbaFile(
  header: AbaHeader,
  transactions: AbaTransaction[],
): string {
  if (transactions.length === 0) {
    throw new Error('Cannot generate .ABA file with zero transactions.');
  }

  const lines: string[] = [];

  // -------------------------------------------------------------------------
  // Record Type 0: Descriptive Record
  // -------------------------------------------------------------------------
  const fi = padRight(header.financialInstitution.toUpperCase().replace(/[^A-Z]/g, '') || 'CBA', 3);
  const supplyingName = padRight(header.userSupplyingName.toUpperCase().replace(/[^A-Z0-9 -]/g, ''), 26);
  const apcaUserId = padLeft(header.userIdentificationNumber.replace(/\D/g, '') || '000000', 6, '0');
  const desc = padRight(header.descriptionOfEntries.toUpperCase().replace(/[^A-Z0-9 -]/g, ''), 12);
  const procDate = formatDateDDMMYY(header.processingDate);

  // Pos 1: '0'
  // Pos 2-18: 17 blank spaces
  // Pos 19-20: Reel sequence number '01'
  // Pos 21-23: FI code (3 chars)
  // Pos 24-30: 7 blank spaces
  // Pos 31-56: Supplying user name (26 chars)
  // Pos 57-62: User identification number (6 digits)
  // Pos 63-74: Description of entries (12 chars)
  // Pos 75-80: Date to be processed (DDMMYY - 6 chars)
  // Pos 81-120: 40 blank spaces
  const record0 =
    '0' +
    ' '.repeat(17) +
    '01' +
    fi +
    ' '.repeat(7) +
    supplyingName +
    apcaUserId +
    desc +
    procDate +
    ' '.repeat(40);

  if (record0.length !== 120) {
    throw new Error(`Record 0 length mismatch: expected 120, got ${record0.length}`);
  }
  lines.push(record0);

  // -------------------------------------------------------------------------
  // Record Type 1: Detail Records
  // -------------------------------------------------------------------------
  let totalCents = 0n;

  for (const tx of transactions) {
    const bsb = formatBsb(tx.bsb);
    const accNumber = padLeft(tx.accountNumber.replace(/[^0-9a-zA-Z]/g, ''), 9, ' ');
    const indicator = ' ';
    const transCode = '50'; // Standard Credit to Account
    const amountBigInt = BigInt(tx.amountCents);
    if (amountBigInt <= 0n) {
      throw new Error(`ABA transaction amount must be positive. Got ${tx.amountCents}`);
    }
    totalCents += amountBigInt;
    const amountStr = padLeft(amountBigInt.toString(), 10, '0');
    const accTitle = padRight(tx.accountName.toUpperCase().replace(/[^A-Z0-9 -]/g, ''), 32);
    const lodgementRef = padRight(tx.lodgementReference.toUpperCase().replace(/[^A-Z0-9 -]/g, ''), 18);
    const traceBsb = formatBsb(tx.traceBsb);
    const traceAccNumber = padLeft(tx.traceAccountNumber.replace(/[^0-9a-zA-Z]/g, ''), 9, ' ');
    const remitter = padRight(tx.remitterName.toUpperCase().replace(/[^A-Z0-9 -]/g, ''), 16);
    const withholdingTax = '00000000'; // 8 zeros

    // Pos 1: '1'
    // Pos 2-8: BSB (7 chars e.g. XXX-XXX)
    // Pos 9-17: Account number (9 chars right-aligned)
    // Pos 18: Indicator (1 char, space)
    // Pos 19-20: Transaction code (2 chars: '50')
    // Pos 21-30: Amount (10 chars zero-padded)
    // Pos 31-62: Account Title (32 chars)
    // Pos 63-80: Lodgement Reference (18 chars)
    // Pos 81-87: Trace BSB (7 chars e.g. XXX-XXX)
    // Pos 88-96: Trace Account Number (9 chars)
    // Pos 97-112: Remitter Name (16 chars)
    // Pos 113-120: Withholding Tax (8 chars: '00000000')
    const record1 =
      '1' +
      bsb +
      accNumber +
      indicator +
      transCode +
      amountStr +
      accTitle +
      lodgementRef +
      traceBsb +
      traceAccNumber +
      remitter +
      withholdingTax;

    if (record1.length !== 120) {
      throw new Error(`Record 1 length mismatch: expected 120, got ${record1.length}`);
    }
    lines.push(record1);
  }

  // -------------------------------------------------------------------------
  // Record Type 7: File Total Record
  // -------------------------------------------------------------------------
  const totalAmountStr = padLeft(totalCents.toString(), 10, '0');
  const countStr = padLeft(transactions.length.toString(), 6, '0');

  // Pos 1: '7'
  // Pos 2-8: '999-999'
  // Pos 9-20: 12 spaces
  // Pos 21-30: Net Total Amount (10 chars zero-padded)
  // Pos 31-40: Credit Total Amount (10 chars zero-padded)
  // Pos 41-50: Debit Total Amount (10 chars zero-padded: '0000000000')
  // Pos 51-74: 24 spaces
  // Pos 75-80: Count of Record Type 1 (6 chars zero-padded)
  // Pos 81-120: 40 spaces
  const record7 =
    '7' +
    '999-999' +
    ' '.repeat(12) +
    totalAmountStr +
    totalAmountStr +
    '0000000000' +
    ' '.repeat(24) +
    countStr +
    ' '.repeat(40);

  if (record7.length !== 120) {
    throw new Error(`Record 7 length mismatch: expected 120, got ${record7.length}`);
  }
  lines.push(record7);

  return lines.join('\r\n') + '\r\n';
}

