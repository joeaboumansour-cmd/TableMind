const fs = require('fs');
const path = require('path');

// Fix sync engine import - add addPendingWrite
const enginePath = path.join(__dirname, '..', 'src', 'lib', 'sync', 'engine.ts');
let engine = fs.readFileSync(enginePath, 'utf8');
if (!engine.includes('addPendingWrite,')) {
  engine = engine.replace(
    '  removePendingWrite,\n} from "@/lib/db/localDB";',
    '  removePendingWrite,\n  addPendingWrite,\n} from "@/lib/db/localDB";'
  );
  fs.writeFileSync(enginePath, engine);
  console.log('Sync engine: addPendingWrite import added');
} else {
  console.log('Sync engine: addPendingWrite already in import');
}

// Fix POS page - add seedProductsIfNeeded to loadData
const posPath = path.join(__dirname, '..', 'src', 'app', 'pos', 'page.tsx');
let pos = fs.readFileSync(posPath, 'utf8');
if (!pos.includes('seedProductsIfNeeded(store_id)')) {
  const oldCode = `// Offline with no cache - show empty state gracefully
            console.log("[POS] Offline with no cached products");`;
  const newCode = `// Offline with no cache - seed from static JSON for first-time offline use
            console.log("[POS] Offline with no cached products, seeding from static data...");
            const seeded = await seedProductsIfNeeded(store_id);
            if (seeded > 0 && isMounted) {
              const seededProducts = await getCachedProducts(store_id);
              if (seededProducts && seededProducts.length > 0) {
                setProducts(mapCachedToProducts(seededProducts));
              }
              toast.success(\`Loaded \${seeded} default products (offline mode)\`);
            }`;
  pos = pos.replace(oldCode, newCode);
  fs.writeFileSync(posPath, pos);
  console.log('POS page: seedProductsIfNeeded added to loadData');
} else {
  console.log('POS page: seedProductsIfNeeded already in loadData');
}

console.log('Done!');
