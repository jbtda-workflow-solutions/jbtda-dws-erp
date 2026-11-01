/**
 * ABN Validation — ATO checksum algorithm.
 *
 * Spec: https://www.abr.business.gov.au/Help/AbnFormat
 *
 * Steps:
 * 1. Strip whitespace, check 11 digits.
 * 2. Subtract 1 from the first digit.
 * 3. Multiply each digit by its weight.
 * 4. Sum all products — must be divisible by 89.
 */
export function validateABN(raw: string): boolean {
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;

  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

  // Subtract 1 from the first digit
  const first = Number(digits[0]) - 1;
  const rest = digits
    .slice(1)
    .split('')
    .map(Number);

  const adjusted = [first, ...rest];

  const sum = adjusted.reduce(
    (acc, digit, i) => acc + digit * (weights[i] ?? 0),
    0,
  );

  return sum % 89 === 0;
}

