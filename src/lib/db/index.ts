// ===
// Local DB Module - Public API
// ===

export {
  cacheProducts,
  upsertProducts,
  upsertSingleProduct,
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductById,
  getCachedProductsCount,
  cacheTransactions,
  getCachedTransactions,
  getCachedTransactionsCount,
  queueTransaction,
  getQueuedTransactions,
  removeQueuedTransaction,
  getQueuedCount,
  clearAllData,
  getLocalDBSize,
  localDB,
  fetchSeedProducts,
  seedProductsIfNeeded,
  queueStockDecrement,
  queueStockDecrementsForTransaction,
  queueCashShiftOpen,
  queueCashShiftClose,
  queueCashAdjustment,
} from "./localDB";

export type {
  CachedProduct,
  CachedTransaction,
  CachedTransactionItem,
  QueuedTransaction,
  QueuedTransactionItem,
  SeedProduct,
  PendingWrite,
  CashShiftOpenPayload,
  CashShiftClosePayload,
  CashAdjustmentPayload,
} from "./localDB";

