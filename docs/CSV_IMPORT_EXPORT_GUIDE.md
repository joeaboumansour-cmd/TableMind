# CSV Import/Export Feature Guide

## Overview

The CSV Import/Export feature allows you to bulk manage your products by importing and exporting data via CSV files. This is useful for:

- Initial product setup
- Bulk price updates
- Stock quantity adjustments
- Creating backups
- Migrating data between stores

## CSV File Format

### Required Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `name` | Text | Product name (max 255 chars) | "Espresso Coffee" |
| `cost_price` | Number | Purchase cost | 1000.00 |
| `selling_price` | Number or Formula | Sale price (supports Excel formulas) | 1500.00 or =D2*(1+G2) |
| `currency` | Text | Currency code (LL or USD) | "LL" |
| `stock_quantity` | Integer | Current stock (can be negative) | 100 |
| `min_stock_threshold` | Integer | Low stock alert level | 10 |

### Optional Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `id` | UUID | Product ID (for updates) | "550e8400-e29b-41d4-a716-446655440000" |
| `barcode` | Text | Barcode (4-20 alphanumeric chars) | "1234567890123" |
| `profit_percentage` | Number | Profit margin % (auto-calculated if empty) | 50.00 |
| `parent_id` | UUID | Parent product ID (for variants) | "550e8400-e29b-41d4-a716-446655440000" |
| `variant_name` | Text | Variant/flavor name (for variants) | "Strawberry" |

### Product Variants Support

Products can have **variants** (e.g., same coffee product in different flavors). The system uses a parent-child structure:

- **Parent product**: Holds the product name, prices (cost & selling), and currency
- **Variant (child)**: References parent via `parent_id`, has its own barcode, variant name, and stock. **Pricing is inherited from the parent** — edit prices on the parent once, and all variants automatically get the new price.

#### Importing Variants

When importing variants via CSV:

| Field | Value |
|-------|-------|
| `name` | Same as parent product name |
| `parent_id` | UUID of the parent product (from export) |
| `variant_name` | Flavor/variant name (e.g., "Strawberry", "Chocolate") |
| `cost_price` | Leave **empty** to inherit from parent |
| `selling_price` | Leave **empty** to inherit from parent |
| `profit_percentage` | Leave **empty** to inherit from parent |
| `stock_quantity` | Set per-variant stock count |
| `barcode` | Unique barcode for this variant |

#### Exporting Variants

When you export products, variants are included in the same CSV with:
- `parent_id` set to the parent product's UUID
- `variant_name` showing the flavor/variant name
- `cost_price`, `selling_price`, `profit_percentage` set to **0** (to indicate inheritance)

To get the effective prices for variants, look up the parent product by its UUID.

### Example CSV

```csv
id,name,barcode,cost_price,selling_price,profit_percentage,currency,stock_quantity,min_stock_threshold,parent_id,variant_name
,Espresso Coffee,12345,1000.00,1500.00,50.00,LL,100,10,,
,Cappuccino,12346,1200.00,2000.00,66.67,LL,50,5,,
550e8400-e29b-41d4-a716-446655440000,Green Tea,12347,800.00,1200.00,50.00,LL,200,20,,
,Espresso Coffee,67890,,,,LL,30,5,550e8400-e29b-41d4-a716-446655440000,Strawberry
,Espresso Coffee,67891,,,,LL,25,5,550e8400-e29b-41d4-a716-446655440000,Chocolate
```

## Excel Formula Support

When you export products, the CSV includes Excel formulas that automatically calculate:
- **Selling Price**: `=D2*(1+G2)` (cost_price × (1 + profit_percentage))
- **Profit Percentage**: `=F2/D2-1` (selling_price / cost_price - 1)

### How It Works

1. **Export**: Products are exported with Excel formulas in the `selling_price` and `profit_percentage` columns
2. **Open in Excel**: Formulas are automatically recognized and calculated
3. **Edit**: Change `cost_price` and formulas auto-update `selling_price` and `profit_percentage`
4. **Import**: When you re-import, the system detects Excel formulas and calculates the correct values

### Example Exported CSV (with formulas)

```csv
id,name,barcode,cost_price,selling_price,currency,profit_percentage,stock_quantity,min_stock_threshold
,,,,# Formula: =D* (1+G) - Auto-calculates selling price,,# Formula: =F/D-1 - Auto-calculates profit percentage,,
,Espresso Coffee,12345,1000.00,=D2*(1+G2),LL,=F2/D2-1,100,10
,Cappuccino,12346,1200.00,=D3*(1+G3),LL,=F3/D3-1,50,5
```

### Benefits

- **Dynamic Calculations**: Edit cost_price and see selling_price update in real-time
- **Error Prevention**: Formulas ensure profit_percentage is always consistent
- **Flexibility**: Break formulas and enter manual values if needed
- **Smart Import**: System handles both formulas and static values

## How to Export Products

1. Navigate to the **Products** page
2. Click the **Download** icon (↓) in the toolbar
3. A CSV file will be downloaded with all your products
4. The file includes the date in the filename: `products_export_2024-01-15.csv`

### Exported Data

The export includes:
- All product fields
- Current stock quantities
- Profit percentages (auto-calculated)
- Both LL and USD prices (depending on product currency)

## How to Import Products

### Step 1: Open Import Dialog

1. Navigate to the **Products** page
2. Click the **Upload** icon (↑) in the toolbar
3. The import dialog will open

### Step 2: Download Template (Optional)

- Click **Template** to download a sample CSV file
- Use this as a starting point for your data

### Step 3: Upload CSV File

You can either:
- **Drag and drop** your CSV file onto the upload area
- **Click to browse** and select your file

### Step 4: Review Data

The system will automatically:
- Parse the CSV file
- Validate all data
- Show a preview of the first 5 rows
- Display any validation errors

### Step 5: Choose Import Mode

Three import modes are available:

#### 1. Upsert (Recommended)
- **Update** existing products (matched by ID or barcode)
- **Create** new products
- **Add** stock quantities to existing stock
- Best for: Regular inventory updates, stock adjustments

#### 2. Create Only
- **Only create** new products
- **Skip** existing products (no updates)
- Best for: Adding new products without affecting existing ones

#### 3. Replace All ⚠️
- **Delete ALL** existing products
- **Import** all products from CSV as new
- **Cannot be undone** - use with caution!
- Best for: Complete inventory replacement, data migration

### Step 6: Import

1. Select your import mode
2. Click **Import**
3. Wait for the import to complete
4. Review the summary report

### Import Result

After import, you'll see:
- Total rows processed
- Successful imports
- Failed imports
- Number of products updated
- Number of products created

## Validation Rules

The system validates:

### Data Format
- **Name**: Required, max 255 characters
- **Barcode**: Optional, 4-20 alphanumeric characters, must be unique per store
- **Cost Price**: Required, non-negative number
- **Selling Price**: Required, non-negative number
- **Currency**: Required, must be "LL" or "USD"
- **Stock Quantity**: Required, non-negative integer
- **Min Stock Threshold**: Required, non-negative integer
- **Profit Percentage**: Optional, auto-calculated if not provided

### Business Rules
- Duplicate barcodes within the same import file are rejected
- Duplicate barcodes with existing products are handled based on import mode
- Maximum 1000 products per import

### File Limits
- Maximum file size: 5MB
- Maximum rows: 1000
- Supported format: CSV only

## Error Handling

### Validation Errors

If your CSV has validation errors:
1. The import will be blocked
2. Errors will be displayed with row numbers and descriptions
3. You can download an error report as CSV
4. Fix the errors and re-upload

### Import Errors

If some rows fail during import:
1. Successful rows will be processed
2. Failed rows will be reported with error messages
3. You can retry failed rows separately

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing required headers" | CSV missing required columns | Ensure all required columns are present |
| "Name is required" | Empty name field | Fill in product names |
| "Cost price must be a valid number" | Non-numeric cost price | Use numbers only (e.g., 1000.00) |
| "Currency must be LL or USD" | Invalid currency code | Use "LL" or "USD" only |
| "Barcode contains invalid characters" | Special characters in barcode | Use only alphanumeric characters |
| "A product with this barcode already exists" | Duplicate barcode | Remove duplicate or use different barcode |

## Best Practices

### 1. Always Backup First
- Export your current products before importing
- This gives you a restore point if needed

### 2. Test with Small Files
- Start with a small test file (5-10 products)
- Verify the results before importing large files

### 3. Use Consistent Formatting
- Use the same decimal format throughout (e.g., 1000.00)
- Keep currency codes consistent (LL or USD)

### 4. Handle Barcodes Carefully
- Barcodes must be unique within your store
- Use 4-20 alphanumeric characters only
- Avoid special characters

### 5. Review Before Importing
- Always review the preview before importing
- Check for any validation errors
- Choose the correct import mode

### 6. Use Upsert for Stock Updates
- For stock adjustments, use Upsert mode
- Stock quantities will be added to existing stock
- Example: If product has 100 stock and you import 50, result is 150

### 7. Use Replace All Carefully
- Only use Replace All for complete inventory replacement
- This will delete ALL existing products
- Make sure your CSV is complete and correct

## Profit Percentage Behavior

The CSV import/export handles profit percentage intelligently:

### Export
- Profit percentage is always included
- It's calculated as: `((selling_price - cost_price) / cost_price) * 100`

### Import
- If profit_percentage is provided, it will be used
- If profit_percentage is empty, it will be calculated automatically
- The database trigger ensures profit_percentage is always accurate

### Example
```csv
cost_price,selling_price,profit_percentage
1000,1500,50.00  # Explicitly set
1000,1500,       # Will be calculated as 50.00
```

## Stock Quantity Behavior

### Upsert Mode
- Stock quantities are **added** to existing stock
- Example: Existing stock = 100, Import stock = 50 → New stock = 150

### Create Only Mode
- Stock quantities are set as provided
- New products start with the imported stock

### Replace All Mode
- All old products are deleted
- New products start with the imported stock

## Audit Trail

All import/export operations are logged:
- Date and time of operation
- Number of products processed
- Success/failure counts
- File name and size
- Error summaries (for imports)

This provides a complete history of data changes for accountability and troubleshooting.

## Troubleshooting

### Import is Slow
- Large files (>500 rows) may take time
- The system processes in batches of 50
- Be patient and don't refresh the page

### Products Not Found After Import
- Check the import result for errors
- Verify you selected the correct import mode
- Refresh the products page

### Duplicate Barcode Errors
- Barcodes must be unique within your store
- Check for duplicates in your CSV
- Check for existing products with the same barcode

### Currency Conversion Issues
- Prices are stored in the product's currency (LL or USD)
- The system converts for display only
- Ensure you're using the correct currency code

## Support

If you encounter issues:
1. Check the error messages carefully
2. Review this guide
3. Download the error report
4. Contact support with details

## API Reference

### Export Endpoint
```
POST /api/products/export
```

### Import Endpoint
```
POST /api/products/import
```

Request body:
```json
{
  "products": [...],
  "mode": "upsert",
  "storeId": "uuid",
  "fileName": "products.csv",
  "fileSize": 12345
}
```

## Version History

- **v1.0.0** - Initial release
  - CSV export functionality
  - CSV import with validation
  - Three import modes (upsert, create_only, replace_all)
  - Audit logging
  - Error reporting