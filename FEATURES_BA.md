# TableMind Feature Specifications
## Comprehensive Business Analysis & Development Guide

**Document Version**: 1.0  
**Date**: February 2026  
**Author**: TableMind Development Team

---

# Table of Contents
1. [Waitlist Management](#1-waitlist-management)
2. [Shift Scheduling](#2-shift-scheduling)
3. [Table Handoff Notes](#3-table-handoff-notes)
4. [Birthday/Anniversary Tracking](#4-birthdayanniversary-tracking)
5. [Offline Mode](#5-offline-mode)
6. [Tablet Optimized Mode](#6-tablet-optimized-mode)
7. [Auto-Assign Tables](#7-auto-assign-tables)
8. [Loyalty Program](#8-loyalty-program)

---

# 1. WAITLIST MANAGEMENT

## 1.1 Business Overview

### Purpose
Enable restaurants to manage walk-in customers efficiently by maintaining a digital waitlist with estimated wait times, party status tracking, and seamless table assignment when seats become available.

### Business Value
- **Reduce wait times**: Customers know exactly how long they'll wait
- **Increase covers**: Better utilization of tables during walk-in heavy periods
- **Customer satisfaction**: SMS notifications when table is ready
- **Data collection**: Track walk-in patterns for staffing decisions

### User Stories
```
As a host/hostess
I want to add walk-in customers to a digital waitlist
So that I can track their position and notify them when their table is ready

As a manager
I want to see waitlist analytics
So that I can optimize staffing during peak walk-in hours

As a customer
I want to receive SMS notifications when my table is ready
So that I don't have to wait standing at the restaurant entrance
```

---

## 1.2 Functional Specifications

### Core Features

#### 1.2.1 Waitlist Entry Creation

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| customer_name | TEXT | YES | Min 2 chars, max 100 | Full name of customer |
| party_size | INTEGER | YES | 1-20 | Number of guests |
| phone | TEXT | NO | Regex: ^[\d\-\+\s]{7,20}$ | For SMS notifications |
| notes | TEXT | NO | Max 500 chars | Special requests, occasion |
| estimated_wait | INTEGER | NO | Minutes | Manual wait override |
| priority | ENUM | NO | normal, vip, urgent | Customer priority level |
| preferences | TEXT[] | NO | Array of tags | Table preferences |

#### 1.2.2 Waitlist Status States
```
WAITING  → (customer arrived) → ARRIVED
WAITING  → (customer left)   → LEFT
WAITING  → (table ready)      → NOTIFIED
ARRIVED  → (seated)            → SEATED
ARRIVED  → (left)              → LEFT
NOTIFIED → (seated)           → SEATED
NOTIFIED → (timeout: 10min)   → LEFT
SEATED   → (finished)         → COMPLETED (triggers loyalty points)
LEFT     → (customer left)    → CANCELLED
```

#### 1.2.3 SMS Notification System
**Notification Triggers:**
- Added to waitlist: "You're #3 on the waitlist. Est. wait: 25 min."
- Table ready: "Your table is ready! Please check in with the host within 10 min."
- Wait time update: "Update: Your new estimated wait is 15 min."
- Removed from waitlist: "We couldn't reach you. Your spot has been released."

#### 1.2.4 Auto-Calculated Wait Time Logic
```typescript
function calculateEstimatedWait(
  partySize: number,
  currentWaitlist: WaitlistEntry[],
  tables: Table[]
): number {
  const suitableTables = tables.filter(
    t => t.capacity >= partySize && !t.is_blocked
  );

  const partiesAhead = currentWaitlist.filter(
    w => w.status === 'waiting' && w.party_size <= partySize
  ).length;

  const averageTurnoverMinutes = 90;
  const baseWait = partiesAhead * averageTurnoverMinutes;
  const adjustmentFactor = suitableTables.length > 0 ? 0.7 : 1.3;

  return Math.round(baseWait * adjustmentFactor);
}
```

---

## 1.3 Database Schema

### 1.3.1 New Tables Required

```sql
-- =============================================
-- WAITLIST TABLE
-- =============================================
CREATE TABLE waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    phone TEXT,
    party_size INTEGER NOT NULL CHECK (party_size > 0 AND party_size <= 20),
    notes TEXT,
    status waitlist_status NOT NULL DEFAULT 'waiting',
    priority priority_level NOT NULL DEFAULT 'normal',
    estimated_wait_minutes INTEGER,
    actual_wait_minutes INTEGER,
    position INTEGER NOT NULL,
    preferences TEXT[] DEFAULT '{}',
    sms_notifications_sent JSONB DEFAULT '[]'::jsonb,
    notified_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    seated_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE waitlist_status AS ENUM ('waiting', 'arrived', 'notified', 'seated', 'left', 'completed', 'cancelled');
CREATE TYPE priority_level AS ENUM ('normal', 'vip', 'urgent');

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for authenticated users" ON waitlist FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_waitlist_restaurant_status ON waitlist(restaurant_id, status);
CREATE INDEX idx_waitlist_created_at ON waitlist(restaurant_id, created_at);
CREATE INDEX idx_waitlist_phone ON waitlist(phone) WHERE phone IS NOT NULL;
```

```sql
-- =============================================
-- SMS_NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE sms_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    customer_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'twilio',
    provider_message_id TEXT,
    status sms_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE sms_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'undelivered');

ALTER TABLE sms_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for authenticated users" ON sms_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_sms_notifications_waitlist_id ON sms_notifications(waitlist_id);
CREATE INDEX idx_sms_notifications_status ON sms_notifications(status);
```

```sql
-- =============================================
-- WAITLIST_SETTINGS TABLE
-- =============================================
CREATE TABLE waitlist_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    default_estimated_wait_minutes INTEGER NOT NULL DEFAULT 25,
    max_party_size INTEGER NOT NULL DEFAULT 12,
    max_waitlist_length INTEGER NOT NULL DEFAULT 50,
    auto_sms_notifications BOOLEAN NOT NULL DEFAULT true,
    notification_reminder_minutes INTEGER NOT NULL DEFAULT 10,
    table_ready_timeout_minutes INTEGER NOT NULL DEFAULT 10,
    average_turnover_minutes INTEGER NOT NULL DEFAULT 90,
    sms_template_added TEXT DEFAULT 'You''re #{position} on the waitlist. Est. wait: {estimated_wait} min.',
    sms_template_ready TEXT DEFAULT 'Your table is ready! Please check in with the host within {timeout} min.',
    sms_template_reminder TEXT DEFAULT 'Reminder: Your table will be ready soon!',
    sms_template_cancelled TEXT DEFAULT 'We couldn''t reach you. Your spot has been released.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.3.2 Migration SQL

```sql
-- Migration: add_waitlist_management.sql
-- Run this in Supabase SQL Editor

-- Enums
DO $$ BEGIN
    CREATE TYPE waitlist_status AS ENUM ('waiting', 'arrived', 'notified', 'seated', 'left', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    CREATE TYPE priority_level AS ENUM ('normal', 'vip', 'urgent');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    CREATE TYPE sms_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'undelivered');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    phone TEXT,
    party_size INTEGER NOT NULL CHECK (party_size > 0 AND party_size <= 20),
    notes TEXT,
    status waitlist_status NOT NULL DEFAULT 'waiting',
    priority priority_level NOT NULL DEFAULT 'normal',
    estimated_wait_minutes INTEGER,
    actual_wait_minutes INTEGER,
    position INTEGER NOT NULL,
    preferences TEXT[] DEFAULT '{}',
    sms_notifications_sent JSONB DEFAULT '[]'::jsonb,
    notified_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    seated_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    customer_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'twilio',
    provider_message_id TEXT,
    status sms_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    default_estimated_wait_minutes INTEGER NOT NULL DEFAULT 25,
    max_party_size INTEGER NOT NULL DEFAULT 12,
    max_waitlist_length INTEGER NOT NULL DEFAULT 50,
    auto_sms_notifications BOOLEAN NOT NULL DEFAULT true,
    notification_reminder_minutes INTEGER NOT NULL DEFAULT 10,
    table_ready_timeout_minutes INTEGER NOT NULL DEFAULT 10,
    average_turnover_minutes INTEGER NOT NULL DEFAULT 90,
    sms_template_added TEXT DEFAULT 'You''re #{position} on the waitlist. Est. wait: {estimated_wait} min.',
    sms_template_ready TEXT DEFAULT 'Your table is ready! Please check in with the host within {timeout} min.',
    sms_template_reminder TEXT DEFAULT 'Reminder: Your table will be ready soon!',
    sms_template_cancelled TEXT DEFAULT 'We couldn''t reach you. Your spot has been released.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update existing tables
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_window BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_quiet_zone BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_outdoor BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS wait_priority INTEGER DEFAULT 50;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_restaurant_status ON waitlist(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_waitlist_id ON sms_notifications(waitlist_id);
```

### 1.3.3 API Routes Required

| Route | Method | Description |
|-------|--------|-------------|
| `/api/waitlist` | GET | Fetch current waitlist |
| `/api/waitlist` | POST | Add new waitlist entry |
| `/api/waitlist/:id` | PUT | Update waitlist entry |
| `/api/waitlist/:id` | DELETE | Remove from waitlist |
| `/api/waitlist/:id/status` | PATCH | Update status |
| `/api/waitlist/:id/seat` | POST | Seat from waitlist |
| `/api/waitlist/settings` | GET/PUT | Settings |
| `/api/waitlist/notify/:id` | POST | Send SMS notification |
| `/api/waitlist/analytics` | GET | Fetch analytics |

### 1.3.4 Frontend Components Required

```
src/app/(dashboard)/waitlist/
├── page.tsx                    # Main waitlist page
├── components/
│   ├── WaitlistQueue.tsx       # Queue display component
│   ├── WaitlistEntryForm.tsx   # Add/edit entry form
│   ├── WaitlistCard.tsx        # Individual entry card
│   ├── NotificationManager.tsx # SMS notification controls
│   ├── WaitlistSettings.tsx    # Settings configuration
│   └── AnalyticsWidget.tsx     # Waitlist analytics widget
├── hooks/
│   ├── useWaitlist.ts          # Waitlist data hook
│   └── useWaitlistActions.ts   # Waitlist mutations hook
└── types/
    └── index.ts               # TypeScript interfaces
```

---

## 1.4 Development Phases

### Phase 1: Core Waitlist (Sprint 1)
- [ ] Create database tables and migrations
- [ ] CRUD API endpoints for waitlist entries
- [ ] Basic waitlist UI (queue view, add/edit forms)
- [ ] Status management (waiting → seated → completed)
- [ ] Table assignment from waitlist

### Phase 2: SMS Notifications (Sprint 2)
- [ ] SMS provider integration (Twilio)
- [ ] Notification templates system
- [ ] Auto-send notifications on status changes
- [ ] Notification delivery tracking

### Phase 3: Advanced Features (Sprint 3)
- [ ] Priority queue management (VIP, urgent)
- [ ] Estimated wait time calculations
- [ ] Waitlist analytics dashboard
- [ ] Real-time updates (Supabase subscriptions)

---

# 2. SHIFT SCHEDULING

## 2.1 Business Overview

### Purpose
Enable restaurant managers to create, manage, and publish staff shift schedules. Staff can view their assigned shifts, request time off, and swap shifts with colleagues.

### Business Value
- **Reduce scheduling time**: Auto-generate schedules based on historical data
- **Improve staff satisfaction**: Self-service shift management
- **Legal compliance**: Track hours to prevent overtime violations
- **Attendance tracking**: Time clock integration for payroll

---

## 2.2 Functional Specifications

### Shift Types

| Type | Description | Color |
|------|-------------|-------|
| OPENING | Morning shift (8AM-4PM) | Green |
| MID | Mid-day shift (11AM-3PM) | Blue |
| DINNER | Evening shift (4PM-10PM) | Purple |
| CLOSING | Late shift (6PM-12AM) | Orange |
| DOUBLE | Full day (8AM-10PM) | Red |
| SPLIT | Two separate periods | Yellow |

### Shift Creation Input
```typescript
interface ShiftCreateInput {
  staff_id: UUID;
  date: DATE;
  start_time: TIME;
  end_time: TIME;
  shift_type: ShiftType;
  role: StaffRole;
  notes?: TEXT;
  break_duration?: INTEGER;
  is_confirmed: BOOLEAN;
}
```

### Swap Request Flow
```
1. Staff A requests shift swap
   ↓
2. Staff B receives notification OR shift available for pickup
   ↓
3. Staff B accepts swap
   ↓
4. Manager approves/denies
   ↓
5. Both notified of outcome
   ↓
6. Schedule updated (if approved)
```

### Time Clock Features
- Location-based clock in (geofencing optional)
- Photo verification (optional)
- Break tracking
- Overtime/late arrival alerts

---

## 2.3 Database Schema

### 2.3.1 New Tables Required

```sql
-- =============================================
-- STAFF TABLE
-- =============================================
CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    role staff_role NOT NULL DEFAULT 'server',
    hourly_rate DECIMAL(6,2),
    max_hours_per_week INTEGER DEFAULT 40,
    is_active BOOLEAN NOT NULL DEFAULT true,
    hire_date DATE,
    emergency_contact TEXT,
    emergency_phone TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE staff_role AS ENUM ('server', 'host', 'bartender', 'cook', 'manager', 'busser', 'barback', 'sa');

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_staff_restaurant ON staff(restaurant_id);
CREATE INDEX idx_staff_role ON staff(role);
```

```sql
-- =============================================
-- SHIFTS TABLE
-- =============================================
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    shift_type shift_type_enum NOT NULL DEFAULT 'regular',
    role staff_role NOT NULL,
    notes TEXT,
    break_duration INTEGER