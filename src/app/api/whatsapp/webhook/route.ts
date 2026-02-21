import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * WhatsApp Webhook Handler
 * 
 * This endpoint receives webhook events from WhatsApp providers:
 * - Twilio: Message status callbacks (delivered, read, failed)
 * - Meta: Message status updates and incoming messages
 * - 360dialog: Message status updates
 * 
 * Setup:
 * 1. Configure webhook URL in your provider dashboard
 * 2. Set WHATSAPP_WEBHOOK_VERIFY_TOKEN in .env.local (for Meta verification)
 * 3. Configure webhook events: message status updates
 */

// GET /api/whatsapp/webhook - Webhook verification (Meta/360dialog)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Meta webhook verification
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  
  if (mode === 'subscribe' && token) {
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    
    if (token === verifyToken) {
      console.log('✅ WhatsApp webhook verified');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error('❌ WhatsApp webhook verification failed: Invalid token');
      return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
    }
  }
  
  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}

// POST /api/whatsapp/webhook - Receive webhook events
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Determine provider based on payload structure
    if (body.object === 'whatsapp_business_account') {
      // Meta WhatsApp Business API
      await handleMetaWebhook(body);
    } else if (body.SmsSid) {
      // Twilio webhook
      await handleTwilioWebhook(body);
    } else if (body.d360_status) {
      // 360dialog webhook
      await handle360DialogWebhook(body);
    } else {
      console.log('Unknown webhook format:', body);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Always return 200 to prevent provider retries
    return NextResponse.json({ success: true });
  }
}

// Handle Meta webhook events
async function handleMetaWebhook(body: any) {
  const entries = body.entry || [];
  
  for (const entry of entries) {
    const changes = entry.changes || [];
    
    for (const change of changes) {
      const value = change.value;
      
      // Handle message status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await updateMessageStatus({
            providerMessageId: status.id,
            status: mapMetaStatus(status.status),
            timestamp: new Date(status.timestamp * 1000).toISOString(),
          });
        }
      }
      
      // Handle incoming messages (if you want two-way messaging)
      if (value.messages) {
        for (const message of value.messages) {
          await handleIncomingMessage({
            from: message.from,
            body: message.text?.body || '',
            timestamp: new Date(message.timestamp * 1000).toISOString(),
            provider: 'meta',
          });
        }
      }
    }
  }
}

// Handle Twilio webhook events
async function handleTwilioWebhook(body: any) {
  const messageSid = body.SmsSid || body.MessageSid;
  const status = body.MessageStatus;
  const errorCode = body.ErrorCode;
  
  await updateMessageStatus({
    providerMessageId: messageSid,
    status: mapTwilioStatus(status),
    timestamp: new Date().toISOString(),
    errorCode: errorCode,
  });
}

// Handle 360dialog webhook events
async function handle360DialogWebhook(body: any) {
  const status = body.d360_status;
  const messageId = body.message_id;
  
  await updateMessageStatus({
    providerMessageId: messageId,
    status: map360DialogStatus(status),
    timestamp: new Date().toISOString(),
  });
}

// Update message status in database
async function updateMessageStatus({
  providerMessageId,
  status,
  timestamp,
  errorCode,
}: {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errorCode?: string;
}) {
  try {
    const supabase = await createClient();
    
    const updateData: any = {
      status,
    };
    
    if (status === 'delivered') {
      updateData.delivered_at = timestamp;
    } else if (status === 'read') {
      updateData.read_at = timestamp;
    } else if (status === 'failed' && errorCode) {
      updateData.error_message = `Error code: ${errorCode}`;
    }
    
    const { error } = await supabase
      .from('whatsapp_logs')
      .update(updateData)
      .eq('provider_message_id', providerMessageId);
    
    if (error) {
      console.error('Failed to update message status:', error);
    } else {
      console.log(`✅ Message ${providerMessageId} updated to ${status}`);
    }
  } catch (error) {
    console.error('Error updating message status:', error);
  }
}

// Handle incoming messages (optional - for two-way messaging)
async function handleIncomingMessage({
  from,
  body,
  timestamp,
  provider,
}: {
  from: string;
  body: string;
  timestamp: string;
  provider: string;
}) {
  console.log(`📨 Incoming message from ${provider}: ${from} - ${body}`);
  
  // TODO: Implement auto-replies or conversation handling
  // Examples:
  // - Reply "CONFIRM" to confirm reservation
  // - Reply "CANCEL" to cancel reservation
  // - Reply "HOURS" to get opening hours
  // - Reply "MENU" to get menu link
  
  // You can store incoming messages in a new table if needed
}

// Status mapping functions
function mapMetaStatus(metaStatus: string): 'sent' | 'delivered' | 'read' | 'failed' {
  switch (metaStatus) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return 'sent';
  }
}

function mapTwilioStatus(twilioStatus: string): 'sent' | 'delivered' | 'read' | 'failed' {
  switch (twilioStatus) {
    case 'sent':
    case 'queued':
    case 'sending':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return 'sent';
  }
}

function map360DialogStatus(status: string): 'sent' | 'delivered' | 'read' | 'failed' {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return 'sent';
  }
}
