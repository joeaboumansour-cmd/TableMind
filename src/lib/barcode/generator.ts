/**
 * EAN-13 Barcode Generation Utility
 *
 * Barcode structure (13 digits, valid EAN-13):
 * [SSSS][CC][CC][CC][NN][D]
 *  │     │  │  │  │   │
 *  │     │  │  │  │   └── Check digit (auto-calculated)
 *  │     │  │  │  └────── Sequence (01-99, per same category+color+size combo)
 *  │     │  │  └───────── Size code (2 digits)
 *  │     │  └──────────── Color code (2 digits)
 *  │     └─────────────── Category code (2 digits)
 *  └───────────────────── Store ID (4 digits)
 *
 * The 13th digit is a check digit calculated using the standard EAN-13 algorithm.
 * This ensures the barcode is scannable by standard barcode scanners.
 */

export interface BarcodeRow {
  /** Unique ID for React keys */
  id: string;
  /** Display number (1, 2, 3, ...) — renumbered on delete */
  number: number;
  /** 4-digit store identifier */
  storeId: string;
  /** Full 13-digit EAN-13 barcode */
  barcode: string;
  /** 2-digit category code */
  categoryCode: string;
  /** Category display name */
  categoryName: string;
  /** 2-digit color code */
  colorCode: string;
  /** Color display name */
  colorName: string;
  /** 2-digit size code */
  sizeCode: string;
  /** Size display name */
  sizeName: string;
  /** Sequence number within the same (store, category, color, size) group */
  sequence: number;
  /** Optional product name for label printing */
  productName?: string;
}

/**
 * Calculate the EAN-13 check digit for a 12-digit data string.
 *
 * Algorithm:
 * 1. Number the positions 1-12 (left to right)
 * 2. Odd positions (1,3,5,7,9,11) × 1
 * 3. Even positions (2,4,6,8,10,12) × 3
 * 4. Sum all products
 * 5. Check digit = (10 - (sum % 10)) % 10
 */
export function calculateEAN13CheckDigit(data12: string): number {
  if (data12.length !== 12 || !/^\d{12}$/.test(data12)) {
    throw new Error("EAN-13 data must be exactly 12 digits");
  }

  const digits = data12.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // Position 0 (1st) is odd → ×1, Position 1 (2nd) is even → ×3, etc.
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generate a full 13-digit EAN-13 barcode.
 *
 * @param storeId - 4-digit store identifier
 * @param categoryCode - 2-digit category code
 * @param colorCode - 2-digit color code
 * @param sizeCode - 2-digit size code
 * @param sequence - Sequence number (1-99) for disambiguation
 * @returns 13-digit EAN-13 barcode string
 */
export function generateEAN13(
  storeId: string,
  categoryCode: string,
  colorCode: string,
  sizeCode: string,
  sequence: number,
): string {
  const seqStr = String(sequence).padStart(2, "0");
  const data12 = `${storeId}${categoryCode}${colorCode}${sizeCode}${seqStr}`;
  const checkDigit = calculateEAN13CheckDigit(data12);
  return `${data12}${checkDigit}`;
}

/**
 * Get the next sequence number for a given (storeId, category, color, size) combo.
 * Looks at existing rows and returns max sequence + 1.
 *
 * @param rows - Current rows in the table
 * @param storeId - 4-digit store identifier
 * @param categoryCode - 2-digit category code
 * @param colorCode - 2-digit color code
 * @param sizeCode - 2-digit size code
 * @returns Next sequence number (starts at 1)
 */
export function getNextSequence(
  rows: BarcodeRow[],
  storeId: string,
  categoryCode: string,
  colorCode: string,
  sizeCode: string,
): number {
  const existing = rows.filter(
    (r) =>
      r.storeId === storeId &&
      r.categoryCode === categoryCode &&
      r.colorCode === colorCode &&
      r.sizeCode === sizeCode,
  );
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((r) => r.sequence)) + 1;
}

/**
 * Regenerate all barcodes after a row deletion.
 *
 * This function:
 * 1. Renumbers display numbers (1, 2, 3, ...)
 * 2. Renumbers sequences within each (storeId, category, color, size) group
 * 3. Recalculates all barcodes with the new sequences
 *
 * @param rows - Remaining rows after deletion (in their current order)
 * @returns New array with renumbered rows and recalculated barcodes
 */
export function regenerateAfterDelete(rows: BarcodeRow[]): BarcodeRow[] {
  const groupSequences = new Map<string, number>();

  return rows.map((row, index) => {
    const key = `${row.storeId}-${row.categoryCode}-${row.colorCode}-${row.sizeCode}`;
    const nextSeq = (groupSequences.get(key) || 0) + 1;
    groupSequences.set(key, nextSeq);

    return {
      ...row,
      number: index + 1,
      sequence: nextSeq,
      barcode: generateEAN13(
        row.storeId,
        row.categoryCode,
        row.colorCode,
        row.sizeCode,
        nextSeq,
      ),
    };
  });
}

/**
 * Generate a unique ID for a row (for React keys).
 */
export function generateRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}