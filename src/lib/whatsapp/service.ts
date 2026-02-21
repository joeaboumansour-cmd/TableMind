import { 
  WhatsAppMessage, 
  WhatsAppSendResult, 
  WhatsAppBulkSendResult,
  WhatsAppConfig,
  WhatsAppTemplate,
  DEFAULT_TEMPLATES,
  formatPhoneForWhatsApp,
  fillTemplate
} from './types';

// WhatsApp Service - handles sending messages via different providers
export class WhatsAppService {
  private config: WhatsAppConfig;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  // Send a single WhatsApp message
  async sendMessage(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const timestamp = new Date().toISOString();
    
    try {
      // Format the phone number
      const formattedPhone = formatPhoneForWhatsApp(message.to);
      
      // Use mock provider for development/testing
      if (this.config.provider === 'mock') {
        return this.mockSendMessage(formattedPhone, message.body);
      }

      // Twilio provider
      if (this.config.provider === 'twilio') {
        return this.sendViaTwilio(formattedPhone, message.body);
      }

      // Meta Business API (WhatsApp Business API)
      if (this.config.provider === 'meta') {
        return this.sendViaMeta(formattedPhone, message.body);
      }

      // 360dialog provider
      if (this.config.provider === '360dialog') {
        return this.sendVia360Dialog(formattedPhone, message.body);
      }

      throw new Error(`Unknown provider: ${this.config.provider}`);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp
      };
    }
  }

  // Send bulk messages
  async sendBulkMessages(
    messages: WhatsAppMessage[]
  ): Promise<WhatsAppBulkSendResult> {
    const results: WhatsAppSendResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process messages sequentially to avoid rate limiting
    for (const message of messages) {
      const result = await this.sendMessage(message);
      results.push(result);
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }

      // Add small delay between messages to respect rate limits
      if (messages.length > 1) {
        await this.delay(1000);
      }
    }

    return {
      total: messages.length,
      successful,
      failed,
      results
    };
  }

  // Send message using a template
  async sendTemplateMessage(
    to: string,
    template: WhatsAppTemplate,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult> {
    const filledContent = fillTemplate(template.content, variables);
    return this.sendMessage({
      to,
      body: filledContent,
      templateName: template.name
    });
  }

  // Get available templates
  getTemplates(): WhatsAppTemplate[] {
    return DEFAULT_TEMPLATES;
  }

  // Get templates by category
  getTemplatesByCategory(category: WhatsAppTemplate['category']): WhatsAppTemplate[] {
    return DEFAULT_TEMPLATES.filter(t => t.category === category);
  }

  // Private: Mock sender for development
  private async mockSendMessage(
    phone: string, 
    body: string
  ): Promise<WhatsAppSendResult> {
    // Simulate network delay
    await this.delay(500);
    
    // Log to console for development
    console.log('📱 MOCK WhatsApp Message:');
    console.log(`To: ${phone}`);
    console.log(`Body: ${body}`);
    console.log('---');

    return {
      success: true,
      messageId: `mock_${Date.now()}`,
      timestamp: new Date().toISOString()
    };
  }

  // Private: Twilio sender
  private async sendViaTwilio(
    phone: string, 
    body: string
  ): Promise<WhatsAppSendResult> {
    // Use apiSecret (Auth Token) for authentication
    const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
    
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.businessAccountId}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: this.config.phoneNumberId,
          To: `whatsapp:${phone}`,
          Body: body
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio error: ${error}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      messageId: data.sid,
      timestamp: new Date().toISOString()
    };
  }

  // Private: Meta Business API sender
  private async sendViaMeta(
    phone: string, 
    body: string
  ): Promise<WhatsAppSendResult> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { body }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Meta API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
      timestamp: new Date().toISOString()
    };
  }

  // Private: 360dialog sender
  private async sendVia360Dialog(
    phone: string, 
    body: string
  ): Promise<WhatsAppSendResult> {
    const response = await fetch(
      'https://waba.360dialog.io/v1/messages',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'D360-Api-Key': this.config.apiKey
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { body }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`360dialog error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
      timestamp: new Date().toISOString()
    };
  }

  // Utility: Delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Factory function to create WhatsApp service from environment
export function createWhatsAppService(): WhatsAppService {
  const provider = (process.env.WHATSAPP_PROVIDER as WhatsAppConfig['provider']) || 'mock';
  
  // Get config based on provider
  let config: WhatsAppConfig;
  
  switch (provider) {
    case 'twilio':
      config = {
        provider: 'twilio',
        apiKey: process.env.TWILIO_ACCOUNT_SID || '',
        apiSecret: process.env.TWILIO_AUTH_TOKEN || '',
        phoneNumberId: process.env.TWILIO_WHATSAPP_PHONE_NUMBER || '',
        businessAccountId: process.env.TWILIO_ACCOUNT_SID,
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL
      };
      break;
      
    case 'meta':
      config = {
        provider: 'meta',
        apiKey: process.env.META_WHATSAPP_API_KEY || '',
        phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
        businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL
      };
      break;
      
    case '360dialog':
      config = {
        provider: '360dialog',
        apiKey: process.env.D360_API_KEY || '',
        phoneNumberId: process.env.D360_PHONE_NUMBER_ID || '',
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL
      };
      break;
      
    case 'mock':
    default:
      config = {
        provider: 'mock',
        apiKey: 'mock-key',
        phoneNumberId: 'mock-phone',
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL
      };
  }

  return new WhatsAppService(config);
}

// Singleton instance for use in API routes
let whatsappServiceInstance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!whatsappServiceInstance) {
    whatsappServiceInstance = createWhatsAppService();
  }
  return whatsappServiceInstance;
}
