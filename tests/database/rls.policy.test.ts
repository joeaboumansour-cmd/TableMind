import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testSupabase, withMerchantContext } from '../setup';

describe('🔐 Row Level Security Policies', () => {
  let testMerchantId: string;
  let otherMerchantId: string;

  beforeAll(async () => {
    // Create two test merchants
    const { data: merchant1 } = await testSupabase
      .from('merchants')
      .insert({ name: 'Test Merchant 1' })
      .select('id')
      .single();

    const { data: merchant2 } = await testSupabase
      .from('merchants')
      .insert({ name: 'Test Merchant 2' })
      .select('id')
      .single();

    testMerchantId = merchant1.id;
    otherMerchantId = merchant2.id;

    // Add test product for each merchant
    await testSupabase.from('products').insert([
      { merchant_id: testMerchantId, name: 'Test Product 1', cost_price: 10, selling_price: 20 },
      { merchant_id: otherMerchantId, name: 'Test Product 2', cost_price: 5, selling_price: 12 }
    ]);
  });

  afterAll(async () => {
    // Cleanup test data
    await testSupabase.from('products').delete().in('merchant_id', [testMerchantId, otherMerchantId]);
    await testSupabase.from('merchants').delete().in('id', [testMerchantId, otherMerchantId]);
  });

  it('✅ Merchant can only view their own products', async () => {
    await withMerchantContext(testMerchantId, async () => {
      const { data: products } = await testSupabase.from('products').select('*');
      
      expect(products).toHaveLength(1);
      expect(products![0].name).toBe('Test Product 1');
      expect(products![0].merchant_id).toBe(testMerchantId);
    });
  });

  it('❌ Merchant cannot view products from other merchants', async () => {
    await withMerchantContext(testMerchantId, async () => {
      const { data: product } = await testSupabase
        .from('products')
        .select('*')
        .eq('merchant_id', otherMerchantId)
        .maybeSingle();

      expect(product).toBeNull();
    });
  });

  it('❌ Unauthenticated user cannot view any products', async () => {
    await testSupabase.auth.signOut();
    const { error, data } = await testSupabase.from('products').select('*');
    
    expect(error).toBeDefined();
    expect(error!.code).toBe('42501'); // RLS violation
    expect(data).toBeNull();
  });
});