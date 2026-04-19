import { config } from 'dotenv';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

export const testSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Test user context for RLS testing
export async function withMerchantContext(merchantId: string, callback: () => Promise<void>) {
  const { data: { user } } = await testSupabase.auth.admin.createUser({
    email: 'test-merchant@test.com',
    app_metadata: { merchant_id: merchantId },
    role: 'authenticated'
  });

  const { data: { access_token } } = await testSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'test-merchant@test.com'
  });

  // Set session for RLS context
  testSupabase.auth.setSession({
    access_token,
    refresh_token: ''
  });

  try {
    await callback();
  } finally {
    await testSupabase.auth.admin.deleteUser(user!.id);
  }
}

beforeAll(async () => {
  console.log('🧪 Test environment initialized');
});

afterAll(async () => {
  await testSupabase.auth.signOut();
});

beforeEach(async () => {
  // Reset test context before each test
});