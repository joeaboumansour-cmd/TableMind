# GoldenSquirrel Mobile POS - Functional Requirements

## 1. User Authentication & Authorization

### 1.1 Login System
- **FR-1.1.1**: Users shall authenticate via username and password
- **FR-1.1.2**: System shall maintain session across browser refreshes
- **FR-1.1.3**: Users shall be able to logout from any screen
- **FR-1.1.4**: System shall support multi-tenant access (different restaurants)

### 1.2 Role Management
- **FR-1.2.1**: Owner role - full access to all features
- **FR-1.2.2**: Manager role - access to sales, inventory, reports
- **FR-1.2.3**: Cashier role - access to POS and basic inventory

## 2. Product Management

### 2.1 Product Catalog
- **FR-2.1.1**: Add new products with name, description, price, and stock quantity
- **FR-2.1.2**: Edit existing product details
- **FR-2.1.3**: Delete or archive products
- **FR-2.1.4**: Set product categories for organization
- **FR-2.1.5**: Upload product images (optional)

### 2.2 Pricing & Profit
- **FR-2.2.1**: Set base cost price for products
- **FR-2.2.2**: Configure merchant profit percentage (global or per-product)
- **FR-2.2.3**: Auto-calculate selling price from cost + profit
- **FR-2.2.4**: Support for manual price overrides

### 2.3 Inventory Tracking
- **FR-2.3.1**: Track stock quantity for each product
- **FR-2.3.2**: Alert when stock falls below minimum threshold
- **FR-2.3.3**: Adjust stock manually (add/remove quantities)
- **FR-2.3.4**: Stock adjustment history log

## 3. Barcode Scanning

### 3.1 Scan Input
- **FR-3.1.1**: Scan barcodes using device camera
- **FR-3.1.2**: Support external USB/Bluetooth barcode scanners
- **FR-3.1.3**: Support multiple barcode formats (EAN-13, UPC-A, Code128)
- **FR-3.1.4**: Manual barcode entry as fallback

### 3.2 Scan Processing
- **FR-3.2.1**: Instant product lookup upon successful scan
- **FR-3.2.2**: Play audio beep feedback on scan
- **FR-3.2.3**: Display "Product not found" message for unknown barcodes
- **FR-3.2.4**: Option to create new product from unknown barcode

## 4. Point of Sale (POS) Interface

### 4.1 Cart Management
- **FR-4.1.1**: Add items to cart by scanning or manual selection
- **FR-4.1.2**: Increase/decrease item quantity in cart (+/- buttons)
- **FR-4.1.3**: Remove items from cart
- **FR-4.1.4**: Display item name, price, quantity, and line total
- **FR-4.1.5**: Real-time cart total calculation
- **FR-4.1.6**: Clear entire cart option

### 4.2 Mobile-Optimized UI
- **FR-4.2.1**: Large touch-friendly buttons for +/- quantity
- **FR-4.2.2**: Swipe gestures for item management
- **FR-4.2.3**: Haptic feedback on button press (if supported)
- **FR-4.2.4**: Dark mode support for low-light environments
- **FR-4.2.5**: Landscape and portrait orientation support

### 4.3 Visual Design
- **FR-4.3.1**: GoldenSquirrel branding (amber/gold color scheme)
- **FR-4.3.2**: Squirrel mascot integration in UI elements
- **FR-4.3.3**: Smooth animations and transitions
- **FR-4.3.4**: Consistent spacing and typography

## 5. Transaction Processing

### 5.1 Payment Methods
- **FR-5.1.1**: Cash payment with change calculation
- **FR-5.1.2**: Credit/debit card payment (manual entry)
- **FR-5.1.3**: Split payment (partial cash, partial card)
- **FR-5.1.4**: Credit/tab tracking for regular customers

### 5.2 Checkout Flow
- **FR-5.2.1**: Display order summary before payment
- **FR-5.2.2**: Calculate tax amounts
- **FR-5.2.3**: Apply discounts (percentage or fixed amount)
- **FR-5.2.4**: Generate unique transaction ID
- **FR-5.2.5**: Record timestamp and cashier info

### 5.3 Receipt Generation
- **FR-5.3.1**: Digital receipt display on screen
- **FR-5.3.2**: Print receipt via connected printer (future)
- **FR-5.3.3**: Email/SMS receipt option (future)
- **FR-5.3.4**: Receipt includes: items, quantities, prices, tax, total, payment method

## 6. Credit Management

### 6.1 Customer Accounts
- **FR-6.1.1**: Create customer profiles with name and contact
- **FR-6.1.2**: Assign credit limit to customers
- **FR-6.1.3**: Track outstanding balance per customer
- **FR-6.1.4**: View customer transaction history

### 6.2 Credit Transactions
- **FR-6.2.1**: Process sale on credit (no immediate payment)
- **FR-6.2.2**: Record credit amount and due date
- **FR-6.2.3**: Process credit payments (partial or full)
- **FR-6.2.4**: Generate credit statements

## 7. Reporting & Analytics

### 7.1 Sales Reports
- **FR-7.1.1**: Daily sales summary (total revenue, transactions, items sold)
- **FR-7.1.2**: Weekly/monthly sales trends
- **FR-7.1.3**: Top selling products
- **FR-7.1.4**: Sales by payment method

### 7.2 Inventory Reports
- **FR-7.2.1**: Current stock levels
- **FR-7.2.2**: Low stock alerts
- **FR-7.2.3**: Stock movement history
- **FR-7.2.4**: Inventory valuation

### 7.3 Financial Reports
- **FR-7.3.1**: Revenue vs. cost analysis
- **FR-7.3.2**: Profit margins by product
- **FR-7.3.3**: Outstanding credits summary
- **FR-7.3.4**: Tax collected report

## 8. PWA Features

### 8.1 Offline Capability
- **FR-8.1.1**: App loads without internet connection
- **FR-8.1.2**: Cart persists offline
- **FR-8.1.3**: Queue transactions for sync when online
- **FR-8.1.4**: Display offline indicator

### 8.2 Installation
- **FR-8.2.1**: "Add to Home Screen" prompt on supported browsers
- **FR-8.2.2**: App icon on home screen after installation
- **FR-8.2.3**: Standalone app experience (no browser UI)
- **FR-8.2.4**: Splash screen on app launch

### 8.3 Performance
- **FR-8.3.1**: App loads in under 3 seconds on 3G
- **FR-8.3.2**: Smooth 60fps animations
- **FR-8.3.3**: Instant response to user interactions
- **FR-8.3.4**: Background sync for data updates

## 9. Settings & Configuration

### 9.1 Business Settings
- **FR-9.1.1**: Configure business name and logo
- **FR-9.1.2**: Set tax rate
- **FR-9.1.3**: Configure currency
- **FR-9.1.4**: Set default profit percentage

### 9.2 User Preferences
- **FR-9.2.1**: Enable/disable sound effects
- **FR-9.2.2**: Configure haptic feedback
- **FR-9.2.3**: Set default payment method
- **FR-9.2.4**: Customize dashboard widgets