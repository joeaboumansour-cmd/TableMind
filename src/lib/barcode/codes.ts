/**
 * Category, Color, and Size code mappings for EAN-13 barcode generation.
 * Each option has a 2-digit code (00-99) that gets encoded into the barcode.
 *
 * To add/remove options, simply edit the arrays below.
 * Codes must be unique within each list and exactly 2 digits.
 */

export interface CodeOption {
  /** 2-digit numeric code (e.g., "01") */
  code: string;
  /** Human-readable name (e.g., "Dress Long") */
  name: string;
}

export const CATEGORIES: CodeOption[] = [
  { code: "01", name: "Dress Long" },
  { code: "02", name: "Dress Short" },
  { code: "03", name: "Top" },
  { code: "04", name: "Bottom" },
  { code: "05", name: "Jacket" },
  { code: "06", name: "T-Shirt" },
  { code: "07", name: "Skirt" },
  { code: "08", name: "Set" },
  { code: "09", name: "Blazer" },
  { code: "10", name: "Sweater" },
  { code: "11", name: "Cardigan" },
  { code: "12", name: "Jumpsuit" },
  { code: "13", name: "Romper" },
  { code: "14", name: "Accessories" },
  { code: "15", name: "Shoes" },
  { code: "16", name: "Scarf" },
  { code: "17", name: "Belt" },
  { code: "18", name: "Bag" },
  { code: "19", name: "Hat" },
  { code: "20", name: "Jewelry" },
  { code: "21", name: "Pants" },
  { code: "22", name: "Jeans" },
  { code: "23", name: "Shorts" },
  { code: "24", name: "Leggings" },
  { code: "25", name: "Coat" },
  { code: "26", name: "Vest" },
  { code: "27", name: "Hoodie" },
  { code: "28", name: "Poncho" },
  { code: "29", name: "Cape" },
  { code: "30", name: "Swimwear" },
  { code: "31", name: "Underwear" },
  { code: "32", name: "Socks" },
  { code: "33", name: "Gloves" },
];

export const COLORS: CodeOption[] = [
  { code: "01", name: "Red" },
  { code: "02", name: "Blue" },
  { code: "03", name: "Black" },
  { code: "04", name: "White" },
  { code: "05", name: "Green" },
  { code: "06", name: "Yellow" },
  { code: "07", name: "Pink" },
  { code: "08", name: "Purple" },
  { code: "09", name: "Brown" },
  { code: "10", name: "Grey" },
  { code: "11", name: "Beige" },
  { code: "12", name: "Orange" },
  { code: "13", name: "Navy" },
  { code: "14", name: "Maroon" },
  { code: "15", name: "Olive" },
  { code: "16", name: "Teal" },
  { code: "17", name: "Burgundy" },
  { code: "18", name: "Gold" },
  { code: "19", name: "Silver" },
  { code: "20", name: "Multi" },
  { code: "21", name: "Cream" },
  { code: "22", name: "Peach" },
  { code: "23", name: "Mint" },
  { code: "24", name: "Lavender" },
  { code: "25", name: "Coral" },
  { code: "26", name: "Turquoise" },
  { code: "27", name: "Mustard" },
  { code: "28", name: "Rose" },
  { code: "29", name: "Charcoal" },
  { code: "30", name: "Ivory" },
];

export const SIZES: CodeOption[] = [
  { code: "01", name: "XS" },
  { code: "02", name: "S" },
  { code: "03", name: "M" },
  { code: "04", name: "L" },
  { code: "05", name: "XL" },
  { code: "06", name: "XXL" },
  { code: "07", name: "One Size" },
  { code: "08", name: "36" },
  { code: "09", name: "37" },
  { code: "10", name: "38" },
  { code: "11", name: "39" },
  { code: "12", name: "40" },
  { code: "13", name: "41" },
  { code: "14", name: "42" },
  { code: "15", name: "43" },
  { code: "16", name: "44" },
  { code: "17", name: "Free Size" },
  { code: "18", name: "Petite" },
  { code: "19", name: "Plus" },
];

/**
 * Get the display name for a code from a list of options.
 */
export function getNameByCode(options: CodeOption[], code: string): string {
  return options.find((o) => o.code === code)?.name || code;
}