// =============================================
// Export audit logging. (audit P0-2)
//
// Lower impact than its siblings — this records that an export happened, it
// does not return the catalogue — but it was the same class of bug: no
// authentication, service-role key, and `storeId` taken from the body, so
// anyone could write audit rows into any store's export history.
//
// Tenancy now comes from the resolved caller and the body's value is ignored.
// =============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { readAuthHeader, resolveCaller } from '@/lib/auth/apiCaller';

export async function POST(request: NextRequest) {
  try {
    const { 
      storeId: _ignoredBodyStoreId,
      totalRows,
      fileName,
      fileSize 
    } = await request.json();
    void _ignoredBodyStoreId;

    const callerClient = await createServiceRoleClient();
    const { storeId: callerStoreId, userId } = readAuthHeader(request);
    if (!callerStoreId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const caller = await resolveCaller(callerClient, callerStoreId, userId);
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const storeId = callerStoreId;

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