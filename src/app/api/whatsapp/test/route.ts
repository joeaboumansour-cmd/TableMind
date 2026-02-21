import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppService } from '@/lib/whatsapp/service';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/whatsapp/test - Send a test WhatsApp message
 * Requires: { to: string, message?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, message = 'This is a test message from TableMind!' } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to (phone number)' },
        { status: 400 }
      );
    }

    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get restaurant info
    const { data: restaurantData, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('user_id', user.id)
      .single();

    if (restaurantError || !restaurantData) {
      return NextResponse.json(
        { error: 'Restaurant not found' },
        { status: 404 }
      );
    }

    // Send test message
    const whatsappService = getWhatsAppService();
    const result = await whatsappService.sendMessage({
      to,
      body: `🧪 Test from ${restaurantData.name}: ${message}`,
    });

    // Log the test message
    await supabase.from('whatsapp_logs').insert({
      restaurant_id: restaurantData.id,
      customer_id: null,
      phone_number: to,
      message: message,
      template_name: 'test',
      status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId || null,
      error_message: result.error || null,
      sent_at: result.timestamp,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send test message' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: result.timestamp,
      provider: process.env.WHATSAPP_PROVIDER || 'mock',
    });

  } catch (error) {
    console.error('WhatsApp test error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
