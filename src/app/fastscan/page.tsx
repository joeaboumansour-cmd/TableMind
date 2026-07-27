"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Download, Trash2, Scan, Barcode, FileText, X } from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";

// ============================================================
// TYPES
// ============================================================

interface ScannedItem {
  barcode: string;
  name: string;
}

// ============================================================
// LOCAL STORAGE
// ============================================================

const STORAGE_KEY = "fastscan_items";

function loadItems(): ScannedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveItems(items: ScannedItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function FastScanPage() {
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [currentBarcode, setCurrentBarcode] = useState("");
  const [currentName, setCurrentName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isExistingRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    setItems(loadItems());
  }, []);

  // Save to localStorage whenever items change
  useEffect(() => {
    saveItems(items);
  }, [items]);

  // ---- Handle barcode scan ----
  const handleBarcodeScan = useCallback((barcode: string) => {
    setCurrentBarcode(barcode);
    setCurrentName("");

    // Check if this barcode already exists
    const existing = items.find(item => item.barcode === barcode);
    isExistingRef.current = !!existing;
    if (existing) {
      setCurrentName(existing.name);
    }

    // Auto-focus the name input (keyboard pops up)
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 100);
  }, [items]);

  // ---- Commit the current entry ----
  const handleCommit = useCallback(() => {
    const barcode = currentBarcode.trim();
    const name = currentName.trim();
    if (!barcode) return;

    setItems(prev => {
      const existingIndex = prev.findIndex(item => item.barcode === barcode);
      if (existingIndex >= 0) {
        // Update existing
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], name };
        return updated;
      } else {
        // Add new at top
        return [{ barcode, name }, ...prev];
      }
    });

    // Clear form, keep keyboard up
    setCurrentBarcode("");
    setCurrentName("");
    isExistingRef.current = false;

    // Re-focus name input for next scan
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  }, [currentBarcode, currentName]);

  // ---- Handle Enter key in name input ----
  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommit();
    }
  };

  // ---- Delete single row ----
  const handleDeleteRow = (barcode: string) => {
    setItems(prev => prev.filter(item => item.barcode !== barcode));
  };

  // ---- Clear all ----
  const handleClearAll = () => {
    if (items.length === 0) return;
    if (window.confirm(`Clear all ${items.length} scanned items?`)) {
      setItems([]);
    }
  };

  // ---- Export CSV ----
  const handleExportCsv = () => {
    if (items.length === 0) return;

    const header = "Barcode,Product Name\n";
    const rows = items
      .map(item => {
        const name = `"${item.name.replace(/"/g, '""')}"`;
        return `${item.barcode},${name}`;
      })
      .join("\n");

    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fastscan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- ESC to toggle scanner ----
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsScanning(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-background border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-amber-500 flex items-center justify-center">
              <Scan className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-tight">FastScan</h1>
              <p className="text-[10px] text-muted-foreground">Supermarket Data Collector</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {items.length} items
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleExportCsv}
              disabled={items.length === 0}
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-500"
              onClick={handleClearAll}
              disabled={items.length === 0}
              title="Clear all"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Scanner */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <div className="flex items-center justify-between mb-1">
          <Button
            variant={isScanning ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setIsScanning(prev => !prev)}
          >
            <Scan className="h-3 w-3" />
            {isScanning ? "Scanner ON" : "Scanner OFF"}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded">ESC</kbd> to toggle
          </span>
        </div>
        <BarcodeScanner
          onScan={handleBarcodeScan}
          isActive={isScanning}
          desktopMode={false}
        />
      </div>

      {/* Input Form */}
      <div className="flex-shrink-0 px-3 pb-2">
        <Card className="border-amber-200/50">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-sm truncate">
                {currentBarcode || <span className="text-muted-foreground italic text-xs">Scan a barcode...</span>}
              </span>
              {isExistingRef.current && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  updating
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                ref={nameInputRef}
                placeholder="Product name..."
                value={currentName}
                onChange={e => setCurrentName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                className="flex-1 h-9 text-sm"
                autoComplete="off"
                disabled={!currentBarcode}
              />
              <Button
                size="sm"
                className="h-9 px-4"
                onClick={handleCommit}
                disabled={!currentBarcode || !currentName.trim()}
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
        <Card className="h-full flex flex-col overflow-hidden">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <FileText className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">No items collected yet</p>
                <p className="text-xs mt-1">Scan a barcode, type the name, press Enter</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b">
                    <th className="text-left font-semibold px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[45%]">Product Name</th>
                    <th className="text-left font-semibold px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[45%]">Barcode</th>
                    <th className="text-center font-semibold px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[10%]">Del</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.barcode} className="border-b border-muted/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 font-medium text-sm truncate max-w-[200px]">
                        {item.name || <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-muted-foreground">{item.barcode}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteRow(item.barcode)}
                          title="Delete"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}