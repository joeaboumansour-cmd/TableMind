import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppService } from '@/lib/whatsapp/service';
import { createClient } from '@/lib/supabase/server';

// POST /api/whatsapp/test - Send a test WhatsApp message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body;

    // Validate required fields
    if (!phone) {
      return NextResponse.json(
        { error: 'Missing required field: phone' },
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

    // Get restaurant data
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

    // Initialize WhatsApp service
    const whatsappService = getWhatsAppService();

    // Send test message
    const result = await whatsappService.sendMessage({
      to: phone,
      body: `🧪 Test message from ${restaurantData.name} via TableMind!\n\nIf you received this, your WhatsApp Business API is configured correctly.`,
    });

    // Log the test message
    await supabase.from('whatsapp_logs').insert({
      restaurant_id: restaurantData.id,
      customer_id: null,
      phone_number: phone,
      message: 'Test message from TableMind',
      template_name: null,
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
    });

  } catch (error) {
    console.error('WhatsApp test error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
