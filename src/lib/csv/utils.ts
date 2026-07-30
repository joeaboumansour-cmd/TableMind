export interface ProductCSVRow {
  id?: string;
  name: string;
  barcode?: string;
  cost_price: number;
  selling_price: number;
  profit_percentage: number;
  currency: 'LL' | 'USD';
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string;
  variant_name?: string;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface ParsedCSVResult {
  data: ProductCSVRow[];
  errors: ValidationError[];
  headers: string[];
}

const REQUIRED_HEADERS = ['name', 'cost_price', 'selling_price', 'currency', 'stock_quantity', 'min_stock_threshold'];
const OPTIONAL_HEADERS = ['id', 'barcode', 'parent_id', 'variant_name', 'profit_percentage'];
const VALID_CURRENCIES = ['LL', 'USD'];
const MAX_NAME_LENGTH = 255;
const MIN_BARCODE_LENGTH = 2;
const MAX_BARCODE_LENGTH = 30;
const BARCODE_REGEX = /^[A-Za-z0-9\-_]+$/;

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * Parse CSV string and validate data
 */
export function parseCSV(csvString: string): ParsedCSVResult {
  const errors: ValidationError[] = [];

  // Split into lines and remove empty lines
  const lines = csvString.split(/\r?\n/).filter(line => line.trim());

  if (lines.length === 0) {
    return { data: [], errors: [{ row: 0, field: 'headers', message: 'CSV file is empty' }], headers: [] };
  }

  // Parse headers
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

  // Check for required headers
  const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    errors.push({
      row: 0,
      field: 'headers',
      message: `Missing required headers: ${missingHeaders.join(', ')}`
    });
    return { data: [], errors, headers };
  }

  // Get column indices
  const colIndex = {
    id: headers.indexOf('id'),
    name: headers.indexOf('name'),
    barcode: headers.indexOf('barcode'),
    cost_price: headers.indexOf('cost_price'),
    selling_price: headers.indexOf('selling_price'),
    profit_percentage: headers.indexOf('profit_percentage'),
    currency: headers.indexOf('currency'),
    stock_quantity: headers.indexOf('stock_quantity'),
    min_stock_threshold: headers.indexOf('min_stock_threshold'),
    parent_id: headers.indexOf('parent_id'),
    variant_name: headers.indexOf('variant_name'),
  };

  const data: ProductCSVRow[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const rowNum = i + 1; // 1-based, +1 for header
    const values = parseCSVLine(line);
    const rowErrors: ValidationError[] = [];

    const getValue = (index: number) => index >= 0 && index < values.length ? values[index] : '';

    // Validate name
    const name = getValue(colIndex.name).trim();
    if (!name) {
      rowErrors.push({ row: rowNum, field: 'name', message: 'Name is required' });
    } else if (name.length > MAX_NAME_LENGTH) {
      rowErrors.push({ row: rowNum, field: 'name', message: `Name exceeds ${MAX_NAME_LENGTH} characters` });
    }

    // Parse parent_id and variant_name
    const parentId = getValue(colIndex.parent_id).trim() || undefined;
    const variantName = getValue(colIndex.variant_name).trim() || undefined;

    // If parent_id is set, variant_name is recommended but not required
    if (parentId && !variantName) {
      rowErrors.push({ row: rowNum, field: 'variant_name', message: 'Variant name is recommended when parent_id is set' });
    }

    // Helper to clean numeric values
    const cleanNumber = (value: string): string => {
      return value.replace(/[^\d.\-]/g, '').trim();
    };

    // For variants, prices are optional (inherit from parent) - still parse but don't require
    const isVariant = !!parentId;

    // Validate cost_price
    const costPriceRaw = cleanNumber(getValue(colIndex.cost_price));
    const costPrice = parseFloat(costPriceRaw);
    if (!isVariant && (isNaN(costPrice) || costPriceRaw === '')) {
      rowErrors.push({ row: rowNum, field: 'cost_price', message: 'Cost price must be a valid number' });
    } else if (!isVariant && costPrice < 0) {
      rowErrors.push({ row: rowNum, field: 'cost_price', message: 'Cost price must be non-negative' });
    }

    // Validate selling_price
    const sellingPriceRaw = cleanNumber(getValue(colIndex.selling_price));
    const sellingPrice = parseFloat(sellingPriceRaw);
    if (!isVariant && (isNaN(sellingPrice) || sellingPriceRaw === '')) {
      rowErrors.push({ row: rowNum, field: 'selling_price', message: 'Selling price must be a valid number' });
    } else if (!isVariant && sellingPrice < 0) {
      rowErrors.push({ row: rowNum, field: 'selling_price', message: 'Selling price must be non-negative' });
    }

    // Parse profit_percentage (optional)
    const profitRaw = cleanNumber(getValue(colIndex.profit_percentage));
    const profitPercentage = profitRaw ? parseFloat(profitRaw) : 0;

    // Validate currency
    const currency = getValue(colIndex.currency).toUpperCase();
    if (!VALID_CURRENCIES.includes(currency)) {
      rowErrors.push({ row: rowNum, field: 'currency', message: 'Currency must be LL or USD' });
    }

    // Validate stock_quantity
    const stockQuantityRaw = cleanNumber(getValue(colIndex.stock_quantity));
    const stockQuantity = parseInt(stockQuantityRaw, 10);
    if (isNaN(stockQuantity) || stockQuantityRaw === '') {
      rowErrors.push({ row: rowNum, field: 'stock_quantity', message: 'Stock quantity must be a valid integer' });
    } else if (stockQuantity < 0) {
      rowErrors.push({ row: rowNum, field: 'stock_quantity', message: 'Stock quantity must be non-negative' });
    }

    // Validate min_stock_threshold
    const minStockThresholdRaw = cleanNumber(getValue(colIndex.min_stock_threshold));
    const minStockThreshold = parseInt(minStockThresholdRaw, 10);
    if (isNaN(minStockThreshold) || minStockThresholdRaw === '') {
      rowErrors.push({ row: rowNum, field: 'min_stock_threshold', message: 'Min stock threshold must be a valid integer' });
    } else if (minStockThreshold < 0) {
      rowErrors.push({ row: rowNum, field: 'min_stock_threshold', message: 'Min stock threshold must be non-negative' });
    }

    // Validate barcode (optional)
    const barcode = getValue(colIndex.barcode).trim();
    if (barcode) {
      if (barcode.length < MIN_BARCODE_LENGTH || barcode.length > MAX_BARCODE_LENGTH) {
        rowErrors.push({ row: rowNum, field: 'barcode', message: `Barcode must be ${MIN_BARCODE_LENGTH}-${MAX_BARCODE_LENGTH} characters` });
      } else if (!BARCODE_REGEX.test(barcode)) {
        rowErrors.push({ row: rowNum, field: 'barcode', message: 'Barcode contains invalid characters' });
      }
    }

    errors.push(...rowErrors);

    if (rowErrors.length === 0) {
      data.push({
        id: getValue(colIndex.id).trim() || undefined,
        name: name,
        barcode: barcode || undefined,
        cost_price: isVariant && (isNaN(costPrice) || costPriceRaw === '') ? 0 : costPrice,
        selling_price: isVariant && (isNaN(sellingPrice) || sellingPriceRaw === '') ? 0 : sellingPrice,
        profit_percentage: profitPercentage,
        currency: currency as 'LL' | 'USD',
        stock_quantity: stockQuantity,
        min_stock_threshold: minStockThreshold,
        parent_id: parentId,
        variant_name: variantName,
      });
    }
  }

  return { data, errors, headers };
}

/**
 * Convert products to CSV string
 */
export function productsToCSV(products: ProductCSVRow[]): string {
  const headers = ['id', 'name', 'barcode', 'cost_price', 'selling_price', 'profit_percentage', 'currency', 'stock_quantity', 'min_stock_threshold', 'parent_id', 'variant_name'];

  const escapeField = (value: string | number): string => {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = products.map(p => [
    escapeField(p.id || ''),
    escapeField(p.name),
    escapeField(p.barcode || ''),
    escapeField(p.cost_price.toFixed(2)),
    escapeField(p.selling_price.toFixed(2)),
    escapeField(p.profit_percentage.toFixed(2)),
    escapeField(p.currency),
    escapeField(p.stock_quantity),
    escapeField(p.min_stock_threshold),
    escapeField(p.parent_id || ''),
    escapeField(p.variant_name || ''),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate CSV template
 */
export function generateCSVTemplate(): string {
  const headers = ['id', 'name', 'barcode', 'cost_price', 'selling_price', 'profit_percentage', 'currency', 'stock_quantity', 'min_stock_threshold', 'parent_id', 'variant_name'];
  const headerNote = ['(leave empty for new)', 'Product Name', 'Barcode', 'Cost Price', 'Selling Price', 'Profit %', 'Currency', 'Stock', 'Min Stock', "Parent's Barcode (for variants, leave empty for parent)", 'Variant Name'];
  const parentExample = ['', 'Coffee', '12345', '1000.00', '1500.00', '50.00', 'LL', '50', '10', '', ''];
  const variantExample = ['', 'Coffee - Strawberry Flavor', '67890', '', '', '', 'LL', '20', '5', '12345', 'Strawberry'];

  return [
    headers.join(','),
    headerNote.join(','),
    parentExample.join(','),
    variantExample.join(','),
  ].join('\n');
}

/**
 * Validate import limits
 * The server now handles large imports efficiently with batch operations and pagination,
 * so there is no hard row limit. We only check for empty files.
 */
export function validateImportLimits(rowCount: number): { valid: boolean; message?: string } {
  if (rowCount === 0) {
    return { valid: false, message: 'CSV file is empty or has no valid data rows' };
  }
  return { valid: true };
}
