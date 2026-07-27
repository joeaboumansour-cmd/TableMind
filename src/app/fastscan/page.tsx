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
  price: string;
  scannedAt: string; // ISO timestamp
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
// PRICE PARSING — detect LL, USD, EUR, etc.
// ============================================================

function parsePrice(text: string): string {
  const patterns = [
    /\$?\s*[\d,]+\.\d{2}\s*(€|EUR|USD|LL)?/i,
    /[\d,]+\.\d{2}\s*€/i,
    /\$[\d,]+\.\d{2}/,
    /[\d,]+\s*LL\b/i,
    /[\d,]+\.\d{2}\s*(USD|EUR)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim().replace(/,/g, "");
    }
  }
  return "";
}

// ============================================================
// OCR — optimized for shelf labels (fast + accurate)
// ============================================================

let tesseractWorker: any = null;

async function getTesseractWorker() {
  if (!tesseractWorker) {
    const Tesseract = await import("tesseract.js");
    tesseractWorker = await Tesseract.createWorker("eng", 1, {
      logger: () => {}, // suppress progress logs
    });
  }
  return tesseractWorker;
}

interface OcrResult {
  name: string;
  price: string;
  confidence: number;
}

async function runOcr(dataUrl: string): Promise<OcrResult> {
  try {
    const worker = await getTesseractWorker();
    
    // PSM 6 = treat as uniform block of text (ideal for shelf labels)
    // OEM 1 = LSTM only (fast)
    const { data } = await worker.recognize(dataUrl, {
      // Restrict character set — no random symbols
      // Allow: letters, digits, spaces, dots, commas, $, €, LL, USD
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,€$USDLL/-%&",
    }, {
      // page segmentation: 6 = assume uniform block of text
      // 7 = single line, 3 = fully auto
      psm: 6,
    });

    const text = data.text.trim();
    const confidence = data.confidence || 0;

    // Reject low-confidence results (< 50%) — prevents garbage
    if (!text || confidence < 50) {
      return { name: "", price: "", confidence };
    }

    const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);

    let price = parsePrice(text);
    let name = "";

    for (const line of lines) {
      const maybePrice = parsePrice(line);
      if (maybePrice) {
        if (!price) price = maybePrice;
        continue;
      }
      if (line.length < 3 || /^\d{8,}$/.test(line)) continue;
      name = line;
      break;
    }

    // Fallback: first non-junk line
    if (!name) {
      for (const line of lines) {
        if (line.length >= 3 && !/^\d{8,}$/.test(line)) {
          name = line;
          break;
        }
      }
    }

    return { name, price, confidence };
  } catch (err) {
    console.error("[FastScan] OCR error:", err);
    return { name: "", price: "", confidence: 0 };
  }
}

// ============================================================
// FRAME GRABBER — crops center 50% to avoid background noise
// ============================================================

function grabFrame(videoEl: HTMLVideoElement): string | null {
  if (videoEl.readyState < 2) return null;

  const canvas = document.createElement("canvas");
  const vw = videoEl.videoWidth || 640;
  const vh = videoEl.videoHeight || 480;

  // Crop to center 60% — removes background edges where labels aren't
  const cropX = vw * 0.2;
  const cropY = vh * 0.2;
  const cropW = vw * 0.6;
  const cropH = vh * 0.6;

  canvas.width = 640;
  canvas.height = 480;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Draw cropped region scaled to full canvas
  ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, 640, 480);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function FastScanPage() {
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [lastScanBarcode, setLastScanBarcode] = useState<string | null>(null);
  const [lastScanStatus, setLastScanStatus] = useState<string>("");
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"name" | "price" | null>(null);
  const ocrInProgressRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    setItems(loadItems());
  }, []);

  // Save to localStorage whenever items change
  useEffect(() => {
    saveItems(items);
  }, [items]);

  // ---- Handle scan: barcode + frame for OCR ----
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    if (ocrInProgressRef.current) return;

    setLastScanBarcode(barcode);
    setLastScanStatus(`Barcode: ${barcode} — running OCR...`);

    // Small delay to let camera stabilize on the label after barcode detection
    await new Promise(r => setTimeout(r, 250));

    const videoEl = document.querySelector("video");
    const frameDataUrl = videoEl ? grabFrame(videoEl) : null;

    let ocrResult: OcrResult = { name: "", price: "", confidence: 0 };

    if (frameDataUrl) {
      ocrInProgressRef.current = true;
      try {
        ocrResult = await runOcr(frameDataUrl);
      } finally {
        ocrInProgressRef.current = false;
      }
    }

    const hasResult = ocrResult.name || ocrResult.price;
    setLastScanStatus(
      hasResult
        ? `✓ ${barcode} — ${ocrResult.name || "?"} ${ocrResult.price || ""} (${Math.round(ocrResult.confidence)}%)`
        : ocrResult.confidence > 0
          ? `✓ ${barcode} — low confidence (${Math.round(ocrResult.confidence)}%), edit manually`
          : `✓ ${barcode} — (no text detected, edit manually)`
    );

    // Add/update item in table (dedup by barcode)
    setItems(prev => {
      const existingIndex = prev.findIndex(item => item.barcode === barcode);
      const newItem: ScannedItem = {
        barcode,
        name: ocrResult.name || prev[existingIndex]?.name || "",
        price: ocrResult.price || prev[existingIndex]?.price || "",
        scannedAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newItem;
        return updated;
      } else {
        return [newItem, ...prev];
      }
    });
  }, []);

  // ---- Delete single row ----
  const handleDeleteRow = (barcode: string) => {
    setItems(prev => prev.filter(item => item.barcode !== barcode));
  };

  // ---- Inline edit helpers ----
  const handleEditStart = (barcode: string, field: "name" | "price") => {
    setEditingBarcode(barcode);
    setEditingField(field);
  };

  const handleEditSave = (barcode: string, field: "name" | "price", value: string) => {
    setItems(prev =>
      prev.map(item =>
        item.barcode === barcode ? { ...item, [field]: value } : item
      )
    );
    setEditingBarcode(null);
    setEditingField(null);
  };

  const handleEditCancel = () => {
    setEditingBarcode(null);
    setEditingField(null);
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

    const header = "Barcode,Product Name,Price,Scanned At\n";
    const rows = items
      .map(item => {
        const name = `"${item.name.replace(/"/g, '""')}"`;
        const price = `"${item.price}"`;
        return `${item.barcode},${name},${price},${item.scannedAt}`;
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

  // ---- Handle keyboard shortcut to stop/start scanner ----
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsScanning(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ---- Scanner toggle ----
  const toggleScanner = () => setIsScanning(prev => !prev);

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

      {/* Scanner Section */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <div className="flex items-center justify-between mb-1">
          <Button
            variant={isScanning ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={toggleScanner}
          >
            <Scan className="h-3 w-3" />
            {isScanning ? "Scanner ON" : "Scanner OFF"}
          </Button>
          {lastScanBarcode && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {lastScanStatus}
            </span>
          )}
        </div>
        <BarcodeScanner
          onScan={handleBarcodeScan}
          isActive={isScanning}
          desktopMode={false}
        />
      </div>

      {/* Data Table */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
        <Card className="h-full flex flex-col overflow-hidden">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <FileText className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">No items collected yet</p>
                <p className="text-xs mt-1">Point at a shelf label and scan</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b">
                    <th className="text-left font-semibold px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[35%]">Barcode</th>
                    <th className="text-left font-semibold px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[40%]">Product Name</th>
                    <th className="text-right font-semibold px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[15%]">Price</th>
                    <th className="text-center font-semibold px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground w-[10%]">Del</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.barcode} className="border-b border-muted/50 hover:bg-muted/20 transition-colors">
                      {/* Barcode */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Barcode className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="font-mono text-xs truncate">{item.barcode}</span>
                        </div>
                      </td>

                      {/* Product Name (inline editable) */}
                      <td
                        className="px-2 py-1.5 cursor-text"
                        onClick={() => handleEditStart(item.barcode, "name")}
                      >
                        {editingBarcode === item.barcode && editingField === "name" ? (
                          <InlineEditor
                            value={item.name}
                            onSave={val => handleEditSave(item.barcode, "name", val)}
                            onCancel={handleEditCancel}
                          />
                        ) : (
                          <span className="text-xs truncate block max-w-[180px]">
                            {item.name || <span className="text-muted-foreground italic">tap to edit</span>}
                          </span>
                        )}
                      </td>

                      {/* Price (inline editable) */}
                      <td
                        className="px-2 py-1.5 text-right cursor-text"
                        onClick={() => handleEditStart(item.barcode, "price")}
                      >
                        {editingBarcode === item.barcode && editingField === "price" ? (
                          <InlineEditor
                            value={item.price}
                            onSave={val => handleEditSave(item.barcode, "price", val)}
                            onCancel={handleEditCancel}
                            className="text-right"
                          />
                        ) : (
                          <span className="font-semibold text-amber-600 text-xs">
                            {item.price || <span className="text-muted-foreground font-normal italic">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Delete row */}
                      <td className="px-2 py-1.5 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteRow(item.barcode)}
                          title="Delete row"
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

      {/* Prompt hint */}
      <div className="flex-shrink-0 px-3 pb-2">
        <p className="text-[10px] text-muted-foreground text-center">
          Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">ESC</kbd> to toggle scanner
        </p>
      </div>
    </div>
  );
}

// ============================================================
// INLINE EDITOR COMPONENT
// ============================================================

function InlineEditor({
  value,
  onSave,
  onCancel,
  className = "",
}: {
  value: string;
  onSave: (val: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSave(inputRef.current?.value ?? "");
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <Input
      ref={inputRef}
      defaultValue={value}
      onKeyDown={handleKeyDown}
      onBlur={e => onSave(e.target.value)}
      className={`h-7 text-xs ${className}`}
      onClick={e => e.stopPropagation()}
    />
  );
}