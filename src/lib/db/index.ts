// =============================================
// Local DB Module - Public API
// =============================================

export {
  cacheProducts,
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductById,
  getCachedProductsCount,
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
  QueuedTransaction,
  QueuedTransactionItem,
} from "./localDB";