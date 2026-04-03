# GoldenSquirrel Mobile POS - System Architecture

## Overview
GoldenSquirrel Mobile POS is a Progressive Web App (PWA) designed for small business point-of-sale operations. The system provides a modern, mobile-first experience for managing inventory, processing sales, and handling transactions.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (PWA)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   UI Layer   │  │  State Mgmt  │  │  Offline     │      │
│  │  (React/     │  │  (Zustand)   │  │  Storage     │      │
│  │   Next.js)   │  │              │  │  (IndexedDB) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND SERVICES                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Next.js API │  │  Supabase    │  │  Real-time   │      │
│  │  Routes      │  │  (Database)  │  │  Sync        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Frontend (PWA)
- **Framework**: Next.js 14 with React
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: Zustand for global state
- **PWA Features**: Service Worker, Manifest, Offline Support

### 2. Authentication Layer
- **Provider**: Supabase Auth
- **Method**: Username/password (existing login system)
- **Session Management**: JWT tokens with localStorage persistence
- **Role-based Access**: Multi-tenant restaurant support

### 3. Database Layer
- **Provider**: Supabase (PostgreSQL)
- **Key Tables**:
  - `products` - Item catalog with prices and stock
  - `transactions` - Sales records
  - `transaction_items` - Line items for each sale
  - `merchants` - Business profiles with profit settings

### 4. Barcode Integration
- **Input Method**: Camera-based scanning or external scanner
- **Format**: EAN-13, UPC-A, Code128
- **Feedback**: Audio beep on successful scan
- **Lookup**: Real-time product search

## Data Flow

```
User Action → UI Component → State Update → API Call → Database
     ↓                                                      ↓
  PWA Cache ←←←←←←←←←←← Response ←←←←←←←←←←←←←←←←←←←←←←
```

## Offline Strategy
1. **Cache First**: Service worker caches app shell and assets
2. **Network First**: API calls try network, fallback to cache
3. **Sync Queue**: Offline transactions queued for later sync
4. **Local Storage**: Cart and recent transactions stored locally

## Security Model
- **Authentication**: Supabase JWT tokens
- **Authorization**: Row-level security (RLS) policies
- **Data Isolation**: Multi-tenant with merchant_id scoping
- **API Protection**: Middleware validates all requests

## Deployment
- **Hosting**: Vercel (Next.js optimized)
- **Database**: Supabase Cloud
- **CDN**: Vercel Edge Network
- **SSL**: Automatic HTTPS for PWA requirements