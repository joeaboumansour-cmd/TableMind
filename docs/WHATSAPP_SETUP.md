# WhatsApp Integration Setup Guide

This guide will help you set up WhatsApp messaging for your TableMind restaurant application using the **Meta WhatsApp Business API**.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Meta WhatsApp Business API Setup](#meta-whatsapp-business-api-setup)
3. [Creating Message Templates](#creating-message-templates)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Pricing](#pricing)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Option 1: Use Mock Provider (Development)
```bash
# No setup required - messages are logged to console
WHATSAPP_PROVIDER=mock
```

### Option 2: Meta WhatsApp Business API (Production)
1. Create Meta Business account
2. Set up WhatsApp Business Platform
3. Get API credentials
4. Add environment variables
5. Create message templates
6. Start sending messages!

---

## Meta WhatsApp Business API Setup

### Step 1: Create Meta Business Account
1. Go to [business.facebook.com](https://business.facebook.com) and sign up
2. Create or log in to your Business Manager account
3. Complete business verification (required for production)

### Step 2: Set Up WhatsApp Business Platform
1. In Business Manager, go to **Meta Business Suite** → **WhatsApp Manager**
2. Click **Get Started** with WhatsApp Business Platform
3. Create a new WhatsApp Business Account
4. Add a phone number and verify it via SMS/call

⚠️ **Important**: Use a phone number not already on WhatsApp. You can use:
- A new SIM card
- A virtual number service
- A landline number

### Step 3: Create System User & Generate Access Token
1. In Business Manager, go to **Settings** → **System Users**
2. Create a new System User with **Admin** role
3. Generate a permanent access token:
   - Select your WhatsApp Business App
   - Grant permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Copy the generated token (you won't see it again!)

### Step 4: Get Phone Number ID
1. In WhatsApp Manager, select your phone number
2. The **Phone Number ID** is shown in the settings
3. Also note your **Business Account ID** from the URL

---

## Creating Message Templates

### Why Templates?
WhatsApp Business API requires pre-approved **message templates** for any message sent outside the 24-hour conversation window. Templates must be approved by Meta (usually takes 24-48 hours).

### Required Templates

Create these templates in Meta Business Manager:

#### 1. Reservation Confirmation
- **Name**: `reservation_confirmation`
- **Category**: Utility
- **Content**:
```
Hi {{1}}! Your reservation at {{2}} is confirmed for {{3}} at {{4}} for {{5}} guests. We look forward to seeing you!
```
- **Variables**: customer_name, restaurant_name, date, time, party_size

#### 2. Reservation Reminder
- **Name**: `reservation_reminder`
- **Category**: Utility
- **Content**:
```
Hi {{1}}! Reminder: You have a reservation at {{2}} at {{3}} for {{4}} guests. Reply CONFIRM to confirm or CANCEL to cancel.
```
- **Variables**: customer_name, restaurant_name, time, party_size

#### 3. Table Ready
- **Name**: `table_ready`
- **Category**: Utility
- **Content**:
```
Hi {{1}}! Your table at {{2}} is ready! Please check in with the host within 10 minutes.
```
- **Variables**: customer_name, restaurant_name

#### 4. Special Offer
- **Name**: `special_offer`
- **Category**: Marketing
- **Content**:
```
Hi {{1}}! {{2}} has a special offer for you: {{3}}. Valid until {{4}}. Book now!
```
- **Variables**: customer_name, restaurant_name, offer_details, expiry_date

#### 5. Birthday Wish
- **Name**: `birthday_wish`
- **Category**: Marketing
- **Content**:
```
🎉 Happy Birthday {{1}}! Wishing you a wonderful day from all of us at {{2}}. Show this message for a complimentary dessert!
```
- **Variables**: customer_name, restaurant_name

### How to Create Templates
1. Go to **Meta Business Suite** → **WhatsApp Manager**
2. Click **Account tools** → **Message templates**
3. Click **Create template**
4. Choose category: **Marketing** or **Utility**
5. Name your template (use lowercase with underscores)
6. Add content using `{{1}}`, `{{2}}` for variables
7. Submit for approval

---

## Configuration

### 1. Copy Environment File
```bash
cp .env.local.example .env.local
```

### 2. Add Meta API Credentials
```env
WHATSAPP_PROVIDER=meta
META_WHATSAPP_API_KEY=your_permanent_access_token_here
META_WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
META_WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id_here
```

### 3. Restart Server
```bash
npm run dev
```

---

## Testing

### Via Settings Page
1. Go to **Settings** → **WhatsApp** in your TableMind dashboard
2. Click the **Test Connection** tab
3. Enter your phone number (with country code, e.g., +96171234567)
4. Click **Send Test**

### Via API
```bash
curl -X POST http://localhost:3000/api/whatsapp/test \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890"}'
```

### Send Bulk Messages
```bash
curl -X POST http://localhost:3000/api/whatsapp/send-bulk \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"to":"+1234567890","message":"Hello!"},
      {"to":"+1234567891","message":"Hello!"}
    ]
  }'
```

---

## Pricing

### Free Tier
- **1,000 conversations per month** - FREE

### Paid Tier (after free limit)
| Region | Cost per Conversation |
|--------|----------------------|
| North America | ~$0.008-0.022 |
| Europe | ~$0.05-0.08 |
| Middle East | ~$0.03-0.05 |
| Asia Pacific | ~$0.005-0.02 |

### What Counts as a Conversation?
- A 24-hour messaging session
- **User-initiated**: FREE (customer sends first message)
- **Business-initiated**: Counts toward limit (you send first message using template)

---

## Troubleshooting

### "Message failed to send"
**Causes & Solutions:**
- ❌ No 24-hour conversation window → Use approved template
- ❌ Template not approved → Wait for Meta approval
- ❌ Invalid phone number → Include country code (e.g., +961)
- ❌ Expired access token → Generate new token

### "Unauthorized" or 401 errors
- Check environment variables are set correctly
- Restart Next.js server after changing `.env.local`
- Verify access token has correct permissions

### "Phone number not registered"
- Complete phone verification in WhatsApp Manager
- Register the phone number if first time use

### Templates rejected by Meta
- Ensure no promotional content in Utility templates
- Use proper grammar and formatting
- Avoid excessive capitalization or special characters

---

## Alternative Providers

If Meta API doesn't work for you, TableMind also supports:

| Provider | Best For | Setup Time |
|----------|----------|------------|
| **Twilio** | Quick start, global coverage | 5 minutes |
| **360dialog** | European businesses | 1 day |
| **Mock** | Development/testing | None |

---

## Next Steps

1. ✅ Set up Meta Business account
2. ✅ Verify phone number
3. ✅ Create and approve message templates
4. ✅ Test sending messages
5. 🔄 Set up webhooks for delivery receipts
6. 🔄 Create automated workflows (reminders, confirmations)

## Support

- **Meta Developers**: [developers.facebook.com](https://developers.facebook.com)
- **WhatsApp Business API Docs**: [developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp)
- **TableMind Issues**: Open a GitHub issue
