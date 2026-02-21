import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppService } from '@/lib/whatsapp/service';
import { createClient } from '@/lib/supabase/server';

// POST /api/whatsapp/send - Send a single WhatsApp message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, message, templateName, variables, customerId } = body;

    // Validate required fields
    if (!to || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: to, message' },
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

    // Send the message
    let result;
    if (templateName && variables) {
      // Use template
      const templates = whatsappService.getTemplates();
      const template = templates.find(t => t.name === templateName);
      if (!template) {
        return NextResponse.json(
          { error: `Template not found: ${templateName}` },
          { status: 400 }
        );
      }
      result = await whatsappService.sendTemplateMessage(to, template, variables);
    } else {
      // Send direct message
      result = await whatsappService.sendMessage({ to, body: message });
    }

    // Log the message to database
    const { error: logError } = await supabase.from('whatsapp_logs').insert({
      restaurant_id: restaurantData.id,
      customer_id: customerId || null,
      phone_number: to,
      message: message,
      template_name: templateName || null,
      status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId || null,
      error_message: result.error || null,
      sent_at: result.timestamp
    });

    if (logError) {
      console.error('Failed to log WhatsApp message:', logError);
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send message' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: result.timestamp
    });

  } catch (error) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
