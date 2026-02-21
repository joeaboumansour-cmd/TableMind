# WhatsApp Integration Setup Guide

This guide will help you set up WhatsApp messaging for your TableMind restaurant application.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Provider Options](#provider-options)
3. [Twilio Setup](#twilio-setup)
4. [Meta WhatsApp Business API Setup](#meta-whatsapp-business-api-setup)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Choose your provider and fill in the credentials

3. Restart your Next.js development server

---

## Provider Options

| Provider | Best For | Cost | Setup Complexity |
|----------|----------|------|------------------|
| **Twilio** | Quick start, global coverage | Pay per message | Easy |
| **Meta** | Direct API, lowest cost | Free tier available | Medium |
| **360dialog** | European businesses | Subscription | Medium |
| **Mock** | Development/testing | Free | None |

---

## Twilio Setup

### Step 1: Create Twilio Account
1. Go to [twilio.com](https://www.twilio.com) and sign up
2. Complete phone verification
3. Get your Account SID and Auth Token from the console dashboard

### Step 2: Enable WhatsApp Sandbox
1. In Twilio Console, go to **Messaging** → **Try it out** → **Send a WhatsApp message**
2. Follow the instructions to join the sandbox by sending a WhatsApp message to the provided number
3. Note your sandbox phone number (e.g., `+1 415 523 8886`)

### Step 3: Configure Environment Variables
Add to your `.env.local`:
```env
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_PHONE_NUMBER=whatsapp:+14155238886
```

### Step 4: Test
Send a test message through your app or use:
```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"to":"+1234567890","message":"Hello from TableMind!"}'
```

### Step 5: Go Live (Production)
To send messages to any WhatsApp number:
1. Apply for WhatsApp Business API access through Twilio
2. Verify your Facebook Business Manager account
3. Submit your message templates for approval
4. Use your approved phone number instead of the sandbox

---

## Meta WhatsApp Business API Setup

### Step 1: Create Meta Business Account
1. Go to [business.facebook.com](https://business.facebook.com)
2. Create or log in to your Business Manager account
3. Complete business verification (required for production)

### Step 2: Set Up WhatsApp Business Platform
1. Go to **Meta Business Suite** → **WhatsApp Manager**
2. Click **Get Started** with WhatsApp Business Platform
3. Create a new WhatsApp Business Account
4. Add a phone number and verify it via SMS/call

### Step 3: Create System User & Generate Access Token
1. In Business Manager, go to **Settings** → **System Users**
2. Create a new System User with **Admin** role
3. Generate a permanent access token:
   - Select your WhatsApp Business App
   - Grant permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Copy the generated token

### Step 4: Get Phone Number ID
1. In WhatsApp Manager, select your phone number
2. The Phone Number ID is shown in the settings

### Step 5: Configure Environment Variables
Add to your `.env.local`:
```env
WHATSAPP_PROVIDER=meta
META_WHATSAPP_API_KEY=your_permanent_access_token_here
META_WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
META_WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id_here
```

### Step 6: Register Phone Number (First Time)
```bash
curl -X POST \
  'https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/register' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"messaging_product":"whatsapp","pin":"YOUR_6_DIGIT_PIN"}'
```

### Step 7: Create Message Templates
Meta requires pre-approved templates for outbound messages. Create templates in WhatsApp Manager:
1. Go to **Account tools** → **Message templates**
2. Create templates matching the ones in `src/lib/whatsapp/types.ts`
3. Submit for approval (usually takes 24-48 hours)

### Step 8: Test
Use the test number provided by Meta or your own after 24-hour conversation window is established.

---

## Testing

### Using Mock Provider (Development)
```env
WHATSAPP_PROVIDER=mock
```
Messages are logged to console instead of being sent.

### Using Twilio Sandbox
1. Join the sandbox by sending the join code to the sandbox number
2. Test with your own WhatsApp number

### Test Script
Create `scripts/test-whatsapp.ts`:
```typescript
async function testWhatsApp() {
  const response = await fetch('http://localhost:3000/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: '+1234567890',
      message: 'Test message from TableMind!',
    }),
  });
  
  const data = await response.json();
  console.log('Result:', data);
}

testWhatsApp();
```

---

## Troubleshooting

### Common Issues

#### "Invalid phone number"
- Ensure phone number includes country code (e.g., `+1234567890`)
- Remove spaces, dashes, and parentheses

#### "Message failed to send" (Twilio)
- Check if recipient has joined the sandbox (for testing)
- Verify Account SID and Auth Token are correct
- Check Twilio console for error details

#### "Message failed to send" (Meta)
- Verify your access token hasn't expired
- Ensure phone number is registered and not banned
- Check if using an approved template for outbound messages
- Meta requires user-initiated conversation or approved template

#### "Unauthorized" or 401 errors
- Check environment variables are set correctly
- Restart Next.js server after changing `.env.local`

### Checking Message Status

View sent messages in your database:
```sql
SELECT * FROM whatsapp_logs 
ORDER BY sent_at DESC 
LIMIT 10;
```

### Provider Comparison

| Feature | Twilio | Meta | 360dialog |
|---------|--------|------|-----------|
| Setup Time | 5 min | 1-2 days | 1 day |
| Sandbox Testing | ✅ | ✅ | ✅ |
| Message Templates | Required | Required | Required |
| Pricing | Per message | Per conversation | Subscription |
| Support | Excellent | Good | Good |
| Global Coverage | Excellent | Good | Europe focus |

---

## Next Steps

1. **Set up webhooks** to receive delivery and read receipts
2. **Create automated workflows** (reminders, confirmations)
3. **Customize message templates** for your restaurant brand
4. **Monitor delivery rates** in the analytics dashboard

## Support

- **Twilio Support**: [support.twilio.com](https://support.twilio.com)
- **Meta Developers**: [developers.facebook.com](https://developers.facebook.com)
- **TableMind Issues**: Open a GitHub issue
