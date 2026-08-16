// ===
// Local DB Module - Public API
// ===

export {
  cacheProducts,
  upsertProducts,
  upsertSingleProduct,
  removeCachedProducts,
  removeCachedProduct,
  reconcileProductsCache,
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductById,
  getCachedProductsCount,
  cacheTransactions,
  getCachedTransactions,
  getCachedTransactionsCount,
  queueTransaction,
  getQueuedTransactions,
  getDeadLetterTransactions,
  recordQueuedTransactionFailure,
  removeQueuedTransaction,
  getQueuedCount,
  getDeadLetterCount,
  getPendingWritesByType,
  clearAllData,
  getLocalDBSize,
  localDB,
  fetchSeedProducts,
  seedProductsIfNeeded,
  queueStockDecrement,
  queueStockDecrementsForTransaction,
  decrementCachedStock,
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

