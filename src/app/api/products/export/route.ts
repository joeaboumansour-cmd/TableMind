import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { 
      storeId,
      totalRows,
      fileName,
      fileSize 
    } = await request.json();

    // Validate inputs
    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      );
    }

    // Initialize Supabase client with service role key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      // Don't fail the export if logging isn't configured
      console.warn('Supabase service key not configured, skipping audit log');
      return NextResponse.json({ success: true });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify store exists
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json(
        { error: 'Store not found' },
        { status: 404 }
      );
    }

    // Log the export operation
    await supabase.rpc('log_export_operation', {
      p_store_id: storeId,
      p_total_rows: totalRows || 0,
      p_file_name: fileName || 'export.csv',
      p_file_size: fileSize || 0,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Export logging error:', error);
    // Don't fail the export if logging fails
    return NextResponse.json({ success: true });
  }
}