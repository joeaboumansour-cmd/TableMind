import { NextResponse } from 'next/server';
import { PROVIDER_ENV_VARS } from '@/lib/whatsapp/types';

/**
 * GET /api/whatsapp/status - Check WhatsApp configuration status
 * Returns which provider is configured and if required env vars are set
 */
export async function GET() {
  const provider = process.env.WHATSAPP_PROVIDER || 'mock';
  
  const result: {
    provider: string;
    configured: boolean;
    envVars: { [key: string]: boolean };
    missingVars: string[];
  } = {
    provider,
    configured: false,
    envVars: {},
    missingVars: [],
  };
  
  // Check provider-specific env vars
  const requiredVars = PROVIDER_ENV_VARS[provider as keyof typeof PROVIDER_ENV_VARS] || {};
  
  for (const [key, envName] of Object.entries(requiredVars)) {
    const envNameStr = envName as string;
    const isSet = !!process.env[envNameStr];
    result.envVars[key] = isSet;
    if (!isSet) {
      result.missingVars.push(envNameStr);
    }
  }
  
  // Provider is configured if all required vars are set
  result.configured = result.missingVars.length === 0;
  
  return NextResponse.json(result);
}
