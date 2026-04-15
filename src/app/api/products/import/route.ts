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
}

interface ImportError {
  row: number;
  field: string;
  message: string;
}

// Maximum rows per batch
const BATCH_SIZE = 50;

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

    if (products.length > 1000) {
      return NextResponse.json(
        { error: 'Maximum 1000 products allowed per import' },
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

    // Process products in batches
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (product, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          // Check for duplicate barcodes within the import batch
          const duplicateInBatch = products.slice(0, globalIndex).find(
            p => p.barcode && p.barcode === product.barcode && p.id !== product.id
          );
          
          if (duplicateInBatch) {
            return {
              success: false,
              error: { row: globalIndex + 1, message: `Duplicate barcode "${product.barcode}" in import file` }
            };
          }

          // Determine if we're updating or creating
          let existingProductId: string | null = null;
          
          if (product.id && existingIds.has(product.id)) {
            existingProductId = product.id;
          } else if (product.barcode && existingBarcodes.has(product.barcode)) {
            existingProductId = existingBarcodes.get(product.barcode) || null;
          }

          const productData = {
            name: product.name,
            barcode: product.barcode || null,
            cost_price: product.cost_price,
            selling_price: product.selling_price,
            currency: product.currency,
            profit_percentage: product.profit_percentage,
            stock_quantity: product.stock_quantity,
            min_stock_threshold: product.min_stock_threshold,
          };

          if (existingProductId && mode !== 'create_only') {
            // Update existing product
            // For upsert mode, add to existing stock; for replace mode, set absolute value
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
                  error: { row: globalIndex + 1, message: 'A product with this barcode already exists' }
                };
              }
              return {
                success: false,
                error: { row: globalIndex + 1, message: error.message }
              };
            }

            return { success: true, id: existingProductId, type: 'updated' };
          } else if (mode === 'create_only' && existingProductId) {
            // Skip existing products in create_only mode
            return {
              success: false,
              error: { row: globalIndex + 1, message: 'Product already exists (skipped in create_only mode)' }
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
                  error: { row: globalIndex + 1, message: 'A product with this barcode already exists' }
                };
              }
              return {
                success: false,
                error: { row: globalIndex + 1, message: error.message }
              };
            }

            return { success: true, id: data?.id, type: 'created' };
          }
        } catch (err: any) {
          return {
            success: false,
            error: { row: globalIndex + 1, message: err.message || 'Unknown error' }
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.success++;
          if (result.type === 'updated') {
            results.updated.push(result.id);
          } else if (result.type === 'created') {
            results.created.push(result.id);
          }
        } else if (result.error) {
          results.failed++;
          results.errors.push(result.error);
        }
      });
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