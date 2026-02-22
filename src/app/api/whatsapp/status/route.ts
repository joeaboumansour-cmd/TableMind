import { NextResponse } from 'next/server';

// GET /api/whatsapp/status - Get WhatsApp configuration status
export async function GET() {
  try {
    const provider = process.env.WHATSAPP_PROVIDER || 'mock';
    
    // Check if Meta provider is configured
    const isMetaConfigured = 
      provider === 'meta' &&
      process.env.META_WHATSAPP_API_KEY &&
      process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    
    // Mask API key for security
    const hasApiKey = !!process.env.META_WHATSAPP_API_KEY;
    
    return NextResponse.json({
      provider,
      isConfigured: isMetaConfigured || provider === 'mock',
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || null,
      businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || null,
      hasApiKey,
    });
  } catch (error) {
    console.error('WhatsApp status error:', error);
    return NextResponse.json(
      { error: 'Failed to get WhatsApp status' },
      { status: 500 }
    );
  }
}
