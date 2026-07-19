// =============================================
// Local DB Module - Public API
// =============================================

export {
  cacheProducts,
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
} from "./localDB";

export type {
  CachedProduct,
  CachedTransaction,
  CachedTransactionItem,
  QueuedTransaction,
  QueuedTransactionItem,
} from "./localDB";
