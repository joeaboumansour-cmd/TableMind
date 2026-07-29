import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface ProductImportData {
  id?: string;
  name: string;
  barcode?: string;
  cost_price: number;
  selling_price: number;
  currency: 'LL' | 'USD';
  profit_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string;
  variant_name?: string;
}

interface ImportError {
  row: number;
  field: string;
  message: string;
}

// Maximum rows per batch
const BATCH_SIZE = 50;

export const config = {
  runtime: 'nodejs',
  maxDuration: 300, // 5 minutes for large imports
};

export async function POST(request: NextRequest) {
  try {
    const { 
      products, 
      mode, 
      storeId,
      fileName,
      fileSize 
    } = await request.json() as { 
      products: ProductImportData[]; 
      mode: 'upsert' | 'create_only' | 'replace_all';
      storeId: string;
      fileName?: string;
      fileSize?: number;
    };

    // Validate inputs
    if (!storeId || !products || !Array.isArray(products)) {
      return NextResponse.json(
        { error: 'Invalid request parameters' },
        { status: 400 }
      );
    }

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No products to import' },
        { status: 400 }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify store exists and get store details
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, username')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json(
        { error: 'Store not found' },
        { status: 404 }
      );
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; message: string }>,
      updated: [] as string[],
      created: [] as string[],
    };

    // Handle replace_all mode - delete all existing products first
    if (mode === 'replace_all') {
      const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('store_id', storeId);

      if (deleteError) {
        return NextResponse.json(
          { error: 'Failed to clear existing products', details: deleteError.message },
          { status: 500 }
        );
      }
    }

    // Get existing products for barcode/id lookup
    const { data: existingProducts } = await supabase
      .from('products')
      .select('id, barcode')
      .eq('store_id', storeId);

    const existingBarcodes = new Map<string, string>();
    const existingIds = new Set<string>();
    
    if (existingProducts) {
      existingProducts.forEach(p => {
        if (p.barcode) {
          existingBarcodes.set(p.barcode, p.id);
        }
        existingIds.add(p.id);
      });
    }

    // Build a map to resolve parent_id by barcode (since CSV uses parent barcode, not UUID)
    // This is populated as parent products are created, so variants can reference them
    const barcodeToUuid = new Map<string, string>();

    // Sort products so parents (no parent_id) are processed before variants (with parent_id)
    // This ensures foreign key constraints are satisfied when variant children reference their parent
    const productsWithIndex = products.map((p, idx) => ({ product: p, originalIndex: idx }));
    const sortedProducts = [...productsWithIndex].sort((a, b) => {
      if (a.product.parent_id && !b.product.parent_id) return 1;   // variants after parents
      if (!a.product.parent_id && b.product.parent_id) return -1;  // parents before variants
      return 0; // same priority, keep original order
    });

    // Track barcodes already processed in this import to detect duplicates
    const processedBarcodes = new Set<string>();

    // Helper function to process a single product (used sequentially to ensure parent before child ordering)
    async function processProduct(
      product: ProductImportData,
      originalIndex: number,
      sortedIndex: number
    ): Promise<{ success: boolean; id?: string; type?: string; error?: { row: number; message: string } }> {
      const csvRowNumber = originalIndex + 2; // +1 for 1-based, +1 for header row

      try {
        // Check for duplicate barcodes within the import
        if (product.barcode && processedBarcodes.has(product.barcode)) {
          return {
            success: false,
            error: { row: csvRowNumber, message: `Duplicate barcode "${product.barcode}" in import file` }
          };
        }
        if (product.barcode) {
          processedBarcodes.add(product.barcode);
        }

        // Determine if we're updating or creating
        let existingProductId: string | null = null;
        
        if (product.id && existingIds.has(product.id)) {
          existingProductId = product.id;
        } else if (product.barcode && existingBarcodes.has(product.barcode)) {
          existingProductId = existingBarcodes.get(product.barcode) || null;
        }

        const isVariant = !!product.parent_id;

        // Resolve parent_id: could be a UUID or a barcode of the parent
        let resolvedParentId: string | null = null;
        if (isVariant) {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          // Try direct UUID (from existing DB)
          if (uuidRegex.test(product.parent_id!) && existingIds.has(product.parent_id!)) {
            resolvedParentId = product.parent_id!;
          } 
          // Try barcode lookup in existing DB products
          else if (existingBarcodes.has(product.parent_id!)) {
            resolvedParentId = existingBarcodes.get(product.parent_id!)!;
          }
          // Try barcode lookup in products already created in this import
          else if (barcodeToUuid.has(product.parent_id!)) {
            resolvedParentId = barcodeToUuid.get(product.parent_id!)!;
          }

          if (!resolvedParentId) {
            return {
              success: false,
              error: { row: csvRowNumber, message: `Parent not found for barcode/UUID "${product.parent_id}". Make sure the parent product exists or comes before the variant in the CSV.` }
            };
          }
        }

        const productData: Record<string, any> = {
          name: product.name,
          barcode: product.barcode || null,
          currency: product.currency,
          stock_quantity: product.stock_quantity,
          min_stock_threshold: product.min_stock_threshold,
        };

        if (isVariant) {
          // Variant: inherit prices from parent (store 0), set parent_id and variant_name
          productData.parent_id = resolvedParentId;
          productData.variant_name = product.variant_name || null;
          productData.cost_price = 0;
          productData.selling_price = 0;
          productData.profit_percentage = 0;
        } else {
          // Parent product: store prices directly
          productData.cost_price = product.cost_price;
          productData.selling_price = product.selling_price;
          productData.profit_percentage = product.profit_percentage;
        }

        if (existingProductId && mode !== 'create_only') {
          // Update existing product
          if (mode === 'upsert') {
            const { data: currentProduct } = await supabase
              .from('products')
              .select('stock_quantity')
              .eq('id', existingProductId)
              .single();
            
            if (currentProduct) {
              productData.stock_quantity = currentProduct.stock_quantity + product.stock_quantity;
            }
          }

          const { error } = await supabase
            .from('products')
            .update(productData)
            .eq('id', existingProductId);

          if (error) {
            if (error.code === '23505') {
              return {
                success: false,
                error: { row: csvRowNumber, message: 'A product with this barcode already exists' }
              };
            }
            return {
              success: false,
              error: { row: csvRowNumber, message: error.message }
            };
          }

          return { success: true, id: existingProductId, type: 'updated' };
        } else if (mode === 'create_only' && existingProductId) {
          // Skip existing products in create_only mode
          return {
            success: false,
            error: { row: csvRowNumber, message: 'Product already exists (skipped in create_only mode)' }
          };
        } else {
          // Create new product
          const { data, error } = await supabase
            .from('products')
            .insert([{
              store_id: storeId,
              ...productData,
            }])
            .select('id')
            .single();

          if (error) {
            if (error.code === '23505') {
              return {
                success: false,
                error: { row: csvRowNumber, message: 'A product with this barcode already exists' }
              };
            }
            return {
              success: false,
              error: { row: csvRowNumber, message: error.message }
            };
          }

          // Track newly created parent product's barcode -> UUID for variant resolution
          if (data?.id && !isVariant && product.barcode) {
            barcodeToUuid.set(product.barcode, data.id);
          }

          return { success: true, id: data?.id, type: 'created' };
        }
      } catch (err: any) {
        return {
          success: false,
          error: { row: csvRowNumber, message: err.message || 'Unknown error' }
        };
      }
    }

    // Process products in strict sequential order (parents first, then variants)
    // Sequential execution is critical: variant children depend on parent products being created first
    for (const { product, originalIndex } of sortedProducts) {
      const result = await processProduct(product, originalIndex, 0);
      
      if (result.success) {
        results.success++;
        if (result.type === 'updated') {
          results.updated.push(result.id!);
        } else if (result.type === 'created') {
          results.created.push(result.id!);
        }
      } else if (result.error) {
        results.failed++;
        results.errors.push(result.error);
      }
    }

    // Log the import operation to audit table
    const errorsSummary = results.errors.length > 0 ? {
      sample_errors: results.errors.slice(0, 10),
      total_errors: results.errors.length
    } : null;

    await supabase.rpc('log_import_operation', {
      p_store_id: storeId,
      p_import_mode: mode,
      p_total_rows: products.length,
      p_successful_rows: results.success,
      p_failed_rows: results.failed,
      p_file_name: fileName || 'unknown',
      p_file_size: fileSize || 0,
      p_errors_summary: errorsSummary
    });

    return NextResponse.json({
      success: true,
      summary: {
        total: products.length,
        successful: results.success,
        failed: results.failed,
        updated: results.updated.length,
        created: results.created.length,
      },
      errors: results.errors.slice(0, 50), // Limit errors in response
      hasMoreErrors: results.errors.length > 50,
    });

  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}