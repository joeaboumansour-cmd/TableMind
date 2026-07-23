const fs = require('fs');
const path = require('path');

// Fix 1: POS page - add seedProductsIfNeeded to import
const posPath = path.join(__dirname, '..', 'src', 'app', 'pos', 'page.tsx');
let pos = fs.readFileSync(posPath, 'utf8');
if (!pos.includes('seedProductsIfNeeded,')) {
  pos = pos.replace(
    'import {\n  getCachedProducts,\n  getCachedProductByBarcode,\n  getCachedProductsCount,\n} from "@/lib/db";',
    'import {\n  getCachedProducts,\n  getCachedProductByBarcode,\n  getCachedProductsCount,\n  seedProductsIfNeeded,\n} from "@/lib/db";'
  );
  fs.writeFileSync(posPath, pos);
  console.log('POS: Added seedProductsIfNeeded to import');
} else {
  console.log('POS: seedProductsIfNeeded already in import');
}

// Fix 2: AuthContext - check what's at line 211
const authPath = path.join(__dirname, '..', 'src', 'lib', 'auth', 'AuthContext.tsx');
let auth = fs.readFileSync(authPath, 'utf8');
// Check if storeUsername is in the login function
const loginMatch = auth.match(/const login = useCallback\(async \(storeUsername: string, password: string\)/);
if (loginMatch) {
  console.log('AuthContext: storeUsername parameter found in login function');
  // Check if cacheCredentials is using storeUsername
  if (auth.includes('cacheCredentials(storeUsername, password')) {
    console.log('AuthContext: cacheCredentials call found with storeUsername');
  } else {
    console.log('AuthContext: cacheCredentials call NOT found - need to check');
  }
}

// Fix 3: Sync engine - fix db import
const enginePath = path.join(__dirname, '..', 'src', 'lib', 'sync', 'engine.ts');
let engine = fs.readFileSync(enginePath, 'utf8');
if (engine.includes("const { db } = await import")) {
  engine = engine.replace(
    "const { db } = await import(\"@/lib/db/localDB\");",
    "const { localDB } = await import(\"@/lib/db/localDB\");"
  );
  engine = engine.replace(
    "await db.pending_writes",
    "await localDB.pending_writes"
  );
  fs.writeFileSync(enginePath, engine);
  console.log('Sync engine: Fixed db import to use localDB');
} else {
  console.log('Sync engine: db import already fixed or not found');
}

console.log('Done!');
