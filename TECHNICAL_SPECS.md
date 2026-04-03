# GoldenSquirrel Mobile POS - Technical Specifications

## 1. Technology Stack

### 1.1 Frontend
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | Next.js | 14.x | React framework with SSR/SSG |
| UI Library | React | 18.x | Component-based UI |
| Styling | Tailwind CSS | 3.x | Utility-first CSS framework |
| Components | shadcn/ui | Latest | Pre-built accessible components |
| State | Zustand | 4.x | Lightweight state management |
| Icons | Lucide React | Latest | Consistent icon library |
| Forms | React Hook Form | 7.x | Form validation and handling |
| Toast | Sonner | Latest | Toast notifications |

### 1.2 Backend
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 18.x | Server-side JavaScript |
| API | Next.js API Routes | 14.x | Serverless API endpoints |
| Database | Supabase (PostgreSQL) | Latest | Primary data storage |
| Auth | Supabase Auth | Latest | Authentication service |
| Real-time | Supabase Realtime | Latest | Live data synchronization |

### 1.3 PWA & Mobile
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Service Worker | Workbox | 6.x | Caching and offline support |
| Manifest | Web App Manifest | - | PWA configuration |
| Storage | IndexedDB | - | Client-side data persistence |
| Audio | Web Audio API | - | Beep sound on scan |

## 2. Project Structure

```
tablemind/
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── service-worker.js      # Service worker
│   ├── icons/                 # App icons (72x72 to 512x512)
│   └── sounds/                # Audio files
│       └── beep.mp3           # Scan beep sound
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/         # Login page
│   │   ├── pos/               # Point of Sale
│   │   │   └── page.tsx       # Main POS interface
│   │   ├── inventory/         # Product management
│   │   │   └── page.tsx       # Inventory list
│   │   ├── reports/           # Analytics dashboard
│   │   │   └── page.tsx       # Reports view
│   │   ├── customers/         # Customer management
│   │   │   └── page.tsx       # Customer list
│   │   ├── settings/          # App settings
│   │   │   └── page.tsx       # Settings page
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Entry redirect
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── pos/               # POS-specific components
│   │   │   ├── Cart.tsx       # Shopping cart
│   │   │   ├── ProductCard.tsx# Product display
│   │   │   ├── Scanner.tsx    # Barcode scanner
│   │   │   └── Checkout.tsx   # Payment processing
│   │   ├── inventory/         # Inventory components
│   │   ├── reports/           # Report components
│   │   └── layout/            # Layout components
│   │       ├── Sidebar.tsx    # Navigation sidebar
│   │       └── Header.tsx     # App header
│   ├── lib/
│   │   ├── supabase/          # Supabase client
│   │   │   ├── client.ts      # Browser client
│   │   │   └── server.ts      # Server client
│   │   ├── stores/            # Zustand stores
│   │   │   ├── cartStore.ts   # Cart state
│   │   │   ├── authStore.ts   # Auth state
│   │   │   └── productStore.ts# Product catalog
│   │   ├── utils/             # Utility functions
│   │   │   ├── format.ts      # Currency/date formatting
│   │   │   ├── barcode.ts     # Barcode parsing
│   │   │   └── audio.ts       # Sound playback
│   │   └── types/             # TypeScript types
│   │       ├── product.ts     # Product type
│   │       ├── cart.ts        # Cart type
│   │       └── transaction.ts # Transaction type
│   ├── hooks/                 # Custom React hooks
│   │   ├── useScanner.ts      # Barcode scanner hook
│   │   ├── useCart.ts         # Cart operations hook
│   │   └── useOffline.ts      # Offline detection hook
│   └── styles/
│       └── globals.css        # Global styles
├── supabase/
│   ├── migrations/            # Database migrations
│   │   ├── 001_initial.sql    # Initial schema
│   │   ├── 002_products.sql   # Products table
│   │   ├── 003_transactions.sql # Transactions table
│   │   └── 004_customers.sql  # Customers table
│   └── seed.sql               # Sample data
├── package.json
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
└── README.md
```

## 3. Database Schema

### 3.1 Core Tables

```sql
-- Merchants (Restaurants/Businesses)
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  default_profit_percentage DECIMAL(5,2) DEFAULT 30.00,
  tax_rate DECIMAL(5,2) DEFAULT 0.00,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  name TEXT NOT NULL,
  description TEXT,
  barcode TEXT,
  cost_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  profit_percentage DECIMAL(5,2),
  stock_quantity INTEGER DEFAULT 0,
  min_stock_threshold INTEGER DEFAULT 5,
  category TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions (Sales)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  transaction_number TEXT NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'credit', 'split')),
  amount_paid DECIMAL(10,2),
  change_given DECIMAL(10,2),
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'voided')),
  cashier_id UUID,
  customer_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction Items (Line Items)
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  credit_limit DECIMAL(10,2) DEFAULT 0,
  current_balance DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Transactions
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  transaction_id UUID REFERENCES transactions(id),
  amount DECIMAL(10,2) NOT NULL,
  type TEXT CHECK (type IN ('charge', 'payment')),
  due_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Indexes
```sql
CREATE INDEX idx_products_merchant ON products(merchant_id);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_transactions_merchant ON transactions(merchant_id);
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transaction_items_transaction ON transaction_items(transaction_id);
CREATE INDEX idx_customers_merchant ON customers(merchant_id);
```

### 3.3 Row Level Security (RLS)
```sql
-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Products policy
CREATE POLICY "Users can only see their merchant's products"
ON products FOR ALL
USING (merchant_id = auth.jwt() ->> 'merchant_id');

-- Transactions policy
CREATE POLICY "Users can only see their merchant's transactions"
ON transactions FOR ALL
USING (merchant_id = auth.jwt() ->> 'merchant_id');
```

## 4. API Endpoints

### 4.1 Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | User login |
| POST | /api/auth/logout | User logout |
| GET | /api/auth/session | Get current session |

### 4.2 Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/products | List all products |
| POST | /api/products | Create product |
| GET | /api/products/[id] | Get product by ID |
| PUT | /api/products/[id] | Update product |
| DELETE | /api/products/[id] | Delete product |
| GET | /api/products/barcode/[code] | Lookup by barcode |

### 4.3 Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/transactions | List transactions |
| POST | /api/transactions | Create transaction |
| GET | /api/transactions/[id] | Get transaction details |
| POST | /api/transactions/[id]/refund | Process refund |

### 4.4 Customers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/customers | List customers |
| POST | /api/customers | Create customer |
| GET | /api/customers/[id] | Get customer details |
| PUT | /api/customers/[id] | Update customer |
| GET | /api/customers/[id]/transactions | Customer history |

### 4.5 Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/reports/daily | Daily sales summary |
| GET | /api/recasts/weekly | Weekly sales trends |
| GET | /api/reports/inventory | Stock levels report |
| GET | /api/reports/credits | Outstanding credits |

## 5. State Management

### 5.1 Zustand Stores

```typescript
// Cart Store
interface CartState {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  total: () => number;
}

// Auth Store
interface AuthState {
  user: User | null;
  token: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
}

// Product Store
interface ProductState {
  products: Product[];
  fetchProducts: () => Promise<void>;
  addProduct: (product: ProductInput) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  findByBarcode: (barcode: string) => Product | undefined;
}
```

## 6. PWA Configuration

### 6.1 manifest.json
```json
{
  "name": "GoldenSquirrel POS",
  "short_name": "GS POS",
  "description": "Mobile Point of Sale for GoldenSquirrel",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a1a",
  "theme_color": "#f59e0b",
  "orientation": "any",
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### 6.2 Service Worker Strategy
```javascript
// Cache-first for static assets
registerRoute(
  ({request}) => request.destination === 'image' || 
                 request.destination === 'script' ||
                 request.destination === 'style',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({maxEntries: 100}),
    ],
  })
);

// Network-first for API calls
registerRoute(
  ({url}) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new ExpirationPlugin({maxEntries: 50}),
    ],
  })
);
```

## 7. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint | < 1.5s | Lighthouse |
| Largest Contentful Paint | < 2.5s | Lighthouse |
| Time to Interactive | < 3.5s | Lighthouse |
| Cumulative Layout Shift | < 0.1 | Lighthouse |
| Cart operations | < 100ms | User perception |
| Barcode scan response | < 200ms | User perception |