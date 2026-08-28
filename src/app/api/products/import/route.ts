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

export const config = {
  runtime: 'nodejs',
  maxDuration: 300, // 5 minutes for large imports
};

/**
 * Fetch ALL products for a store using pagination.
 * Supabase/PostgREST enforces a server-side max-rows limit (default 1000),
 * so we must paginate through all pages using .range().
 */
async function fetchAllProductsForStore(
  supabase: any,
  storeId: string,
  select: string = 'id, barcode'
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allProducts: any[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('products')
      .select(select)
      .eq('store_id', storeId)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allProducts = allProducts.concat(data);
    if (data.length < PAGE_SIZE) break; // Last page

    from += PAGE_SIZE;
  }

  return allProducts;
}

/**
 * Insert products in chunks to avoid Supabase/PostgREST's 1000-row limit on inserts.
 * Returns array of created records with their ids and barcodes.
 */
async function insertProductsInChunks(
  supabase: any,
  products: Record<string, any>[],
  chunkSize: number = 500
): Promise<{ data: any[]; errors: { index: number; message: string }[] }> {
  const allData: any[] = [];
  const allErrors: { index: number; message: string }[] = [];

  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    console.log(`Inserting chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(products.length / chunkSize)} (${chunk.length} products)`);

    const { data, error } = await supabase
      .from('products')
      .insert(chunk)
      .select('id, barcode');

    if (error) {
      console.error(`Chunk insert error (${chunk.length} products):`, error.message);
      // Fall back to individual inserts for this chunk
      for (let j = 0; j < chunk.length; j++) {
        try {
          const { data: singleData, error: singleError } = await supabase
            .from('products')
            .insert([chunk[j]])
            .select('id, barcode')
            .single();

          if (singleError) {
            allErrors.push({ index: i + j, message: singleError.code === '23505'
              ? 'A product with this barcode already exists'
              : singleError.message });
          } else if (singleData) {
            allData.push(singleData);
          }
        } catch (err: any) {
          allErrors.push({ index: i + j, message: err.message || 'Unknown error' });
        }
      }
    } else if (data) {
      allData.push(...data);
    }
  }

  return { data: allData, errors: allErrors };
}

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

    // Handle replace_all mode - delete all existing products
    //
    // This deletes the CATALOGUE ONLY. It used to delete every
    // `transaction_items` row and every `transactions` row for the store
    // first, because `transaction_items.product_id` was a blocking FK and
    // there was no other way to get the product deletes through -- so
    // importing a spreadsheet destroyed the store's entire sales history,
    // which the dialog never warned about and nobody asked for.
    //
    // Migration 028 made that FK `ON DELETE SET NULL`, so the sold lines
    // survive the delete with their own denormalised name/price/quantity and
    // simply stop pointing at a catalogue row. Do not reintroduce the
    // transaction deletes.
    if (mode === 'replace_all') {
      console.log(`Replace all mode: deleting all products for store ${storeId}`);

      const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('store_id', storeId);

      if (deleteError) {
        console.error('Failed to delete products:', deleteError);
        return NextResponse.json(
          { error: 'Failed to clear existing products', details: deleteError.message },
          { status: 500 }
        );
      }

      console.log('Successfully cleared the existing catalogue (sales history kept)');
    }

    // ─────────────────────────────────────────────────────────────
    // FETCH ALL EXISTING PRODUCTS WITH PAGINATION
    // Supabase returns max 1000 rows per query, so we paginate
    // ─────────────────────────────────────────────────────────────
    console.log(`Fetching all existing products for store ${storeId}...`);
    const existingProducts = await fetchAllProductsForStore(supabase, storeId, 'id, barcode, stock_quantity');

    const existingBarcodes = new Map<string, string>();
    const existingIds = new Set<string>();
    const existingStockMap = new Map<string, number>();
    
    if (existingProducts) {
      existingProducts.forEach(p => {
        if (p.barcode) {
          existingBarcodes.set(p.barcode, p.id);
        }
        existingIds.add(p.id);
        existingStockMap.set(p.id, p.stock_quantity || 0);
      });
    }
    console.log(`Found ${existingProducts.length} existing products`);

    // ─────────────────────────────────────────────────────────────
    // BATCH PROCESSING: Separate parents and variants
    // ─────────────────────────────────────────────────────────────
    // Track barcodes already processed in this import to detect duplicates
    const processedBarcodes = new Set<string>();
    // Map to resolve parent barcode -> UUID for newly created parents
    const barcodeToUuid = new Map<string, string>();

    // Separate products into parents and variants, with original row indices
    const parents: Array<{ product: ProductImportData; originalIndex: number }> = [];
    const variants: Array<{ product: ProductImportData; originalIndex: number }> = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const csvRowNumber = i + 2; // +1 for 1-based, +1 for header row

      // Check for duplicate barcodes within the import
      if (product.barcode) {
        if (processedBarcodes.has(product.barcode)) {
          results.failed++;
          results.errors.push({ row: csvRowNumber, message: `Duplicate barcode "${product.barcode}" in import file` });
          continue;
        }
        processedBarcodes.add(product.barcode);
      }

      if (product.parent_id) {
        variants.push({ product, originalIndex: i });
      } else {
        parents.push({ product, originalIndex: i });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 1: BATCH PROCESS ALL PARENT PRODUCTS
    // ─────────────────────────────────────────────────────────────
    console.log(`Processing ${parents.length} parent products...`);

    // Build arrays for batch operations
    const parentsToCreate: Array<{ product: ProductImportData; originalIndex: number }> = [];
    const parentsToUpdate: Array<{ product: ProductImportData; originalIndex: number; existingId: string }> = [];

    for (const { product, originalIndex } of parents) {
      const csvRowNumber = originalIndex + 2;

      // Determine if we're updating or creating
      let existingProductId: string | null = null;
      
      if (product.id && existingIds.has(product.id)) {
        existingProductId = product.id;
      } else if (product.barcode && existingBarcodes.has(product.barcode)) {
        existingProductId = existingBarcodes.get(product.barcode) || null;
      }

      if (existingProductId && mode !== 'create_only') {
        parentsToUpdate.push({ product, originalIndex, existingId: existingProductId });
      } else if (mode === 'create_only' && existingProductId) {
        results.failed++;
        results.errors.push({ row: csvRowNumber, message: 'Product already exists (skipped in create_only mode)' });
      } else {
        parentsToCreate.push({ product, originalIndex });
      }
    }

    // Batch CREATE parent products (in chunks to avoid Supabase 1000-row limit)
    if (parentsToCreate.length > 0) {
      const insertData = parentsToCreate.map(({ product }) => ({
        store_id: storeId,
        name: product.name,
        barcode: product.barcode || null,
        cost_price: product.cost_price,
        selling_price: product.selling_price,
        profit_percentage: product.profit_percentage,
        currency: product.currency,
        stock_quantity: product.stock_quantity,
        min_stock_threshold: product.min_stock_threshold,
      }));

      const { data: createdData, errors: insertErrors } = await insertProductsInChunks(supabase, insertData);

      // Track successfully created products
      if (createdData) {
        for (const data of createdData) {
          results.success++;
          results.created.push(data.id);
          if (data.barcode) {
            barcodeToUuid.set(data.barcode, data.id);
          }
        }
      }

      // Report errors with correct row numbers
      for (const err of insertErrors) {
        const originalIndex = parentsToCreate[err.index]?.originalIndex;
        const csvRowNumber = originalIndex !== undefined ? originalIndex + 2 : 0;
        results.failed++;
        results.errors.push({ row: csvRowNumber, message: err.message });
      }
    }

    // Batch UPDATE parent products
    if (parentsToUpdate.length > 0) {
      for (const { product, originalIndex, existingId } of parentsToUpdate) {
        const csvRowNumber = originalIndex + 2;
        try {
          const productData: Record<string, any> = {
            name: product.name,
            barcode: product.barcode || null,
            cost_price: product.cost_price,
            selling_price: product.selling_price,
            profit_percentage: product.profit_percentage,
            currency: product.currency,
            min_stock_threshold: product.min_stock_threshold,
          };

          if (mode === 'upsert') {
            // Add stock to existing stock
            const currentStock = existingStockMap.get(existingId) || 0;
            productData.stock_quantity = currentStock + product.stock_quantity;
          } else {
            productData.stock_quantity = product.stock_quantity;
          }

          const { error } = await supabase
            .from('products')
            .update(productData)
            .eq('id', existingId);

          if (error) {
            results.failed++;
            results.errors.push({ row: csvRowNumber, message: error.code === '23505'
              ? 'A product with this barcode already exists'
              : error.message });
          } else {
            results.success++;
            results.updated.push(existingId);
            // Track barcode for variant resolution
            if (product.barcode) {
              barcodeToUuid.set(product.barcode, existingId);
            }
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push({ row: csvRowNumber, message: err.message || 'Unknown error' });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 2: BATCH PROCESS ALL VARIANT PRODUCTS
    // ─────────────────────────────────────────────────────────────
    console.log(`Processing ${variants.length} variant products...`);

    const variantsToCreate: Array<{ product: ProductImportData; originalIndex: number; resolvedParentId: string }> = [];
    const variantsToUpdate: Array<{ product: ProductImportData; originalIndex: number; existingId: string; resolvedParentId: string }> = [];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const { product, originalIndex } of variants) {
      const csvRowNumber = originalIndex + 2;

      // Resolve parent_id: could be a UUID or a barcode of the parent
      let resolvedParentId: string | null = null;
      
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
        results.failed++;
        results.errors.push({ row: csvRowNumber, message: `Parent not found for barcode/UUID "${product.parent_id}". Make sure the parent product exists or comes before the variant in the CSV.` });
        continue;
      }

      // Determine if we're updating or creating
      let existingProductId: string | null = null;
      
      if (product.id && existingIds.has(product.id)) {
        existingProductId = product.id;
      } else if (product.barcode && existingBarcodes.has(product.barcode)) {
        existingProductId = existingBarcodes.get(product.barcode) || null;
      }

      if (existingProductId && mode !== 'create_only') {
        variantsToUpdate.push({ product, originalIndex, existingId: existingProductId, resolvedParentId });
      } else if (mode === 'create_only' && existingProductId) {
        results.failed++;
        results.errors.push({ row: csvRowNumber, message: 'Product already exists (skipped in create_only mode)' });
      } else {
        variantsToCreate.push({ product, originalIndex, resolvedParentId });
      }
    }

    // Batch CREATE variant products (in chunks)
    if (variantsToCreate.length > 0) {
      const insertData = variantsToCreate.map(({ product, resolvedParentId }) => ({
        store_id: storeId,
        name: product.name,
        barcode: product.barcode || null,
        cost_price: 0,
        selling_price: 0,
        profit_percentage: 0,
        currency: product.currency,
        stock_quantity: product.stock_quantity,
        min_stock_threshold: product.min_stock_threshold,
        parent_id: resolvedParentId,
        variant_name: product.variant_name || null,
      }));

      const { data: createdData, errors: insertErrors } = await insertProductsInChunks(supabase, insertData);

      // Track successfully created variants
      if (createdData) {
        for (const data of createdData) {
          results.success++;
          results.created.push(data.id);
        }
      }

      // Report errors with correct row numbers
      for (const err of insertErrors) {
        const originalIndex = variantsToCreate[err.index]?.originalIndex;
        const csvRowNumber = originalIndex !== undefined ? originalIndex + 2 : 0;
        results.failed++;
        results.errors.push({ row: csvRowNumber, message: err.message });
      }
    }

    // Batch UPDATE variant products
    if (variantsToUpdate.length > 0) {
      for (const { product, originalIndex, existingId, resolvedParentId } of variantsToUpdate) {
        const csvRowNumber = originalIndex + 2;
        try {
          const productData: Record<string, any> = {
            name: product.name,
            barcode: product.barcode || null,
            parent_id: resolvedParentId,
            variant_name: product.variant_name || null,
            min_stock_threshold: product.min_stock_threshold,
          };

          if (mode === 'upsert') {
            const currentStock = existingStockMap.get(existingId) || 0;
            productData.stock_quantity = currentStock + product.stock_quantity;
          } else {
            productData.stock_quantity = product.stock_quantity;
          }

          const { error } = await supabase
            .from('products')
            .update(productData)
            .eq('id', existingId);

          if (error) {
            results.failed++;
            results.errors.push({ row: csvRowNumber, message: error.code === '23505'
              ? 'A product with this barcode already exists'
              : error.message });
          } else {
            results.success++;
            results.updated.push(existingId);
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push({ row: csvRowNumber, message: err.message || 'Unknown error' });
        }
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

    console.log(`Import complete: ${results.success} success, ${results.failed} failed, ${results.errors.length} errors reported`);
    if (results.errors.length > 0) {
      console.log('First 5 errors:', results.errors.slice(0, 5));
    }

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