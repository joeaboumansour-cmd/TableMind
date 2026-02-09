// =============================================
// IndexedDB Service for Offline Data Storage
// =============================================

import type { WaitlistEntry } from "../types/waitlist";

const DB_NAME = "TableMindDB";
const DB_VERSION = 1;

interface PendingAction {
  id: string;
  type: "create" | "update" | "delete";
  store: string;
  data: unknown;
  timestamp: number;
}

interface SyncState {
  lastSyncedAt: number | null;
  pendingCount: number;
  isOnline: boolean;
}

// Initialize IndexedDB
export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("IndexedDB not available on server"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Failed to open IndexedDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for waitlist entries
      if (!db.objectStoreNames.contains("waitlist")) {
        const waitlistStore = db.createObjectStore("waitlist", { keyPath: "id" });
        waitlistStore.createIndex("restaurant_id", "restaurant_id", { unique: false });
        waitlistStore.createIndex("status", "status", { unique: false });
        waitlistStore.createIndex("position", "position", { unique: false });
      }

      // Store for reservations (offline viewing)
      if (!db.objectStoreNames.contains("reservations")) {
        const reservationsStore = db.createObjectStore("reservations", { keyPath: "id" });
        reservationsStore.createIndex("restaurant_id", "restaurant_id", { unique: false });
        reservationsStore.createIndex("date", "start_time", { unique: false });
      }

      // Store for customers
      if (!db.objectStoreNames.contains("customers")) {
        const customersStore = db.createObjectStore("customers", { keyPath: "id" });
        customersStore.createIndex("restaurant_id", "restaurant_id", { unique: false });
        customersStore.createIndex("phone", "phone", { unique: false });
      }

      // Store for pending sync actions
      if (!db.objectStoreNames.contains("pendingActions")) {
        const pendingStore = db.createObjectStore("pendingActions", { keyPath: "id" });
        pendingStore.createIndex("timestamp", "timestamp", { unique: false });
        pendingStore.createIndex("store", "store", { unique: false });
      }

      // Store for sync state
      if (!db.objectStoreNames.contains("syncState")) {
        db.createObjectStore("syncState", { keyPath: "id" });
      }
    };
  });
}

// Generic CRUD operations
export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getById<T>(storeName: string, id: string): Promise<T | undefined> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function put<T>(storeName: string, data: T): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put(data);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function remove(storeName: string, id: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clear(storeName: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// =============================================
// Pending Actions Queue (Background Sync)
// =============================================

export async function addPendingAction(action: PendingAction): Promise<void> {
  await put("pendingActions", action);
  await updateSyncState({ pendingCount: await getPendingCount() });
}

export async function getPendingActions(): Promise<PendingAction[]> {
  return getAll<PendingAction>("pendingActions");
}

export async function removePendingAction(id: string): Promise<void> {
  await remove("pendingActions", id);
  await updateSyncState({ pendingCount: await getPendingCount() });
}

export async function getPendingCount(): Promise<number> {
  const actions = await getPendingActions();
  return actions.length;
}

export async function clearPendingActions(): Promise<void> {
  await clear("pendingActions");
  await updateSyncState({ pendingCount: 0, lastSyncedAt: Date.now() });
}

// =============================================
// Sync State Management
// =============================================

export async function getSyncState(): Promise<SyncState> {
  const state = await getById<SyncState>("syncState", "main");
  return state || { lastSyncedAt: null, pendingCount: 0, isOnline: navigator.onLine };
}

export async function updateSyncState(updates: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  await put("syncState", { ...current, ...updates, id: "main" } as SyncState);
}

// =============================================
// Offline Waitlist Operations
// =============================================

export async function saveWaitlistOffline(entries: WaitlistEntry[]): Promise<void> {
  const db = await initDB();
  const transaction = db.transaction("waitlist", "readwrite");
  const store = transaction.objectStore("waitlist");

  // Clear existing and add new
  await new Promise<void>((resolve, reject) => {
    const clearRequest = store.clear();
    clearRequest.onsuccess = () => resolve();
    clearRequest.onerror = () => reject(clearRequest.error);
  });

  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export async function getOfflineWaitlist(): Promise<WaitlistEntry[]> {
  return getAll<WaitlistEntry>("waitlist");
}

// =============================================
// Network Status
// =============================================

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export function addNetworkListeners(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

// =============================================
// Data Sync Utility
// =============================================

export async function syncPendingActions(): Promise<{ success: boolean; synced: number; failed: number }> {
  if (!isOnline()) {
    return { success: false, synced: 0, failed: 0 };
  }

  const actions = await getPendingActions();
  let synced = 0;
  let failed = 0;

  for (const action of actions) {
    try {
      switch (action.store) {
        case "waitlist":
          await syncWaitlistAction(action);
          break;
        // Add more stores as needed
        default:
          console.warn(`Unknown store: ${action.store}`);
      }

      await removePendingAction(action.id);
      synced++;
    } catch (error) {
      console.error("Failed to sync action:", action, error);
      failed++;
    }
  }

  await updateSyncState({ lastSyncedAt: Date.now(), pendingCount: failed });
  return { success: true, synced, failed };
}

async function syncWaitlistAction(action: PendingAction): Promise<void> {
  const { type, data, store } = action;
  const endpoint = "/api/waitlist";

  switch (type) {
    case "create": {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create");
      break;
    }
    case "update": {
      const entry = data as { id: string };
      const response = await fetch(`${endpoint}/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update");
      break;
    }
    case "delete": {
      const entry = data as { id: string };
      const response = await fetch(`${endpoint}/${entry.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete");
      break;
    }
  }
}

// Export types
export type { PendingAction, SyncState };
