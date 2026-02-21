import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppService } from '@/lib/whatsapp/service';
import { createClient } from '@/lib/supabase/server';

// POST /api/whatsapp/send-bulk - Send bulk WhatsApp messages
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, templateName, variables } = body;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Missing required field: messages (array)' },
        { status: 400 }
      );
    }

    // Limit bulk sends to prevent abuse
    if (messages.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 messages allowed per bulk send' },
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

    // Get restaurant ID for the user
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

    // Prepare messages
    const whatsappMessages = messages.map((msg: any) => ({
      to: msg.to,
      body: msg.message || msg.body
    }));

    // Send bulk messages
    const result = await whatsappService.sendBulkMessages(whatsappMessages);

    // Log all messages to database
    const logs = result.results.map((res, index) => ({
      restaurant_id: restaurantData.id,
      customer_id: messages[index]?.customerId || null,
      phone_number: messages[index]?.to,
      message: messages[index]?.message || messages[index]?.body,
      template_name: templateName || null,
      status: res.success ? 'sent' : 'failed',
      provider_message_id: res.messageId || null,
      error_message: res.error || null,
      sent_at: res.timestamp
    }));

    const { error: logError } = await supabase.from('whatsapp_logs').insert(logs);

    if (logError) {
      console.error('Failed to log bulk WhatsApp messages:', logError);
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: result.total,
        successful: result.successful,
        failed: result.failed
      },
      results: result.results
    });

  } catch (error) {
    console.error('WhatsApp bulk send error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
