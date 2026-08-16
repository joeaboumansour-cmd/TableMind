"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Download,
  X,
  FileDown,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";
import JsBarcode from "jsbarcode";
import { useAuth } from "@/lib/auth/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, COLORS, SIZES, getNameByCode } from "@/lib/barcode/codes";
import {
  generateEAN13,
  getNextSequence,
  regenerateAfterDelete,
  generateRowId,
  type BarcodeRow,
} from "@/lib/barcode/generator";
import BarcodeLabel from "@/components/BarcodeLabel";

const STORAGE_KEY = "barcodegen_store_id";
const TABLE_KEY = "barcodegen_table";

export default function BarcodeGeneratorPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [supabase] = useState(() => createClient());

  // ── Form state ──────────────────────────────────────────────
  const [storeId, setStoreId] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [colorCode, setColorCode] = useState("");
  const [sizeCode, setSizeCode] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("1");

  // ── Table state ─────────────────────────────────────────────
  const [rows, setRows] = useState<BarcodeRow[]>([]);

  // ── POS check state ─────────────────────────────────────────
  const [posInfo, setPosInfo] = useState<{ count: number; nextSeq: number } | null>(null);
  const [isCheckingPOS, setIsCheckingPOS] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Load from localStorage on mount ─────────────────────────
  useEffect(() => {
    try {
      const savedStoreId = localStorage.getItem(STORAGE_KEY);
      if (savedStoreId) setStoreId(savedStoreId);

      const savedTable = localStorage.getItem(TABLE_KEY);
      if (savedTable) {
        const parsed = JSON.parse(savedTable) as BarcodeRow[];
        if (Array.isArray(parsed)) setRows(parsed);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // ── Persist storeId ─────────────────────────────────────────
  useEffect(() => {
    if (storeId) localStorage.setItem(STORAGE_KEY, storeId);
  }, [storeId]);

  // ── Persist table ───────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(TABLE_KEY, JSON.stringify(rows));
  }, [rows]);

  // ── Check POS for existing barcodes (debounced) ─────────────
  useEffect(() => {
    if (!user?.storeId || storeId.length !== 4 || !categoryCode || !colorCode || !sizeCode) {
      setPosInfo(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingPOS(true);
      try {
        const prefix = `${storeId}${categoryCode}${colorCode}${sizeCode}`;
        const { data, error } = await supabase
          .from("products")
          .select("barcode")
          .eq("store_id", user.storeId)
          .like("barcode", `${prefix}%`);

        if (error || !data) {
          setPosInfo(null);
          return;
        }

        const sequences = data
          .map((p: { barcode: string | null }) => p.barcode)
          .filter((b: string | null): b is string => !!b && b.startsWith(prefix) && b.length === 13)
          .map((b: string) => parseInt(b.slice(8, 10)))
          .filter((n: number) => !isNaN(n));

        const maxSeq = sequences.length > 0 ? Math.max(...sequences) : 0;
        const localMax = getNextSequence(rows, storeId, categoryCode, colorCode, sizeCode) - 1;
        const nextSeq = Math.max(maxSeq, localMax) + 1;

        setPosInfo({ count: sequences.length, nextSeq });
      } catch {
        setPosInfo(null);
      } finally {
        setIsCheckingPOS(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [user, storeId, categoryCode, colorCode, sizeCode, rows, supabase]);

  // ── Store ID input: 4 digits only ───────────────────────────
  const handleStoreIdChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 4);
    setStoreId(cleaned);
  };

  // ── Generate barcode(s) ─────────────────────────────────────
  const handleGenerate = async () => {
    if (isGenerating) return;

    if (storeId.length !== 4) {
      toast.error("Store ID must be exactly 4 digits");
      return;
    }
    if (!categoryCode) {
      toast.error("Please select a category");
      return;
    }
    if (!colorCode) {
      toast.error("Please select a color");
      return;
    }
    if (!sizeCode) {
      toast.error("Please select a size");
      return;
    }

    setIsGenerating(true);

    try {
      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const newRows: BarcodeRow[] = [];

      // Check POS for existing barcodes to avoid duplicates
      let posMaxSeq = 0;
      if (user?.storeId) {
        try {
          const prefix = `${storeId}${categoryCode}${colorCode}${sizeCode}`;
          const { data } = await supabase
            .from("products")
            .select("barcode")
            .eq("store_id", user.storeId)
            .like("barcode", `${prefix}%`);

          if (data) {
            const sequences = data
              .map((p: { barcode: string | null }) => p.barcode)
              .filter((b: string | null): b is string => !!b && b.startsWith(prefix) && b.length === 13)
              .map((b: string) => parseInt(b.slice(8, 10)))
              .filter((n: number) => !isNaN(n));
            posMaxSeq = sequences.length > 0 ? Math.max(...sequences) : 0;
          }
        } catch {
          toast.warning("Could not check POS for existing barcodes — using session data only");
        }
      }

      for (let i = 0; i < qty; i++) {
        const allRows = [...rows, ...newRows];
        const localNextSeq = getNextSequence(
          allRows,
          storeId,
          categoryCode,
          colorCode,
          sizeCode,
        );
        const posNextSeq = posMaxSeq + 1 + i;
        const sequence = Math.max(localNextSeq, posNextSeq);

        if (sequence > 99) {
          toast.error("Maximum of 99 barcodes per category/color/size combination");
          break;
        }

        const barcode = generateEAN13(storeId, categoryCode, colorCode, sizeCode, sequence);

        newRows.push({
          id: generateRowId(),
          number: allRows.length + 1,
          storeId,
          barcode,
          categoryCode,
          categoryName: getNameByCode(CATEGORIES, categoryCode),
          colorCode,
          colorName: getNameByCode(COLORS, colorCode),
          sizeCode,
          sizeName: getNameByCode(SIZES, sizeCode),
          sequence,
          productName: productName.trim() || undefined,
        });
      }

      if (newRows.length > 0) {
        setRows([...rows, ...newRows]);
        toast.success(`Generated ${newRows.length} barcode${newRows.length > 1 ? "s" : ""}`);
      }

      // Don't reset category/color/size — user might want to generate more
      setProductName("");
      setQuantity("1");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Delete a row and renumber ────────────────────────────────
  const handleDelete = (id: string) => {
    const filtered = rows.filter((r) => r.id !== id);
    const regenerated = regenerateAfterDelete(filtered);
    setRows(regenerated);
    toast.success("Row deleted, barcodes renumbered");
  };

  // ── Clear all ───────────────────────────────────────────────
  const handleClearAll = () => {
    if (!confirm("Clear all generated barcodes? This cannot be undone.")) return;
    setRows([]);
    toast.success("Table cleared");
  };

  // ── Copy barcode to clipboard ───────────────────────────────
  const handleCopy = async (barcode: string) => {
    try {
      await navigator.clipboard.writeText(barcode);
      toast.success(`Copied: ${barcode}`);
    } catch {
      toast.error("Failed to copy");
    }
  };

  // ── Download CSV ─────────────────────────────────────────────
  const handleDownloadCSV = () => {
    if (rows.length === 0) {
      toast.error("No barcodes to export");
      return;
    }

    const headers = ["Number", "Barcode", "Category", "Color", "Size", "Sequence", "Product Name"];
    const csvRows = rows.map((r) =>
      [r.number, r.barcode, r.categoryName, r.colorName, r.sizeName, r.sequence, r.productName || ""]
        .map((v) => `"${String(v)}"`)
        .join(","),
    );

    const csv = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barcodes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  // ── Download standalone HTML labels file ────────────────────
  const handleDownloadLabelsHTML = () => {
    if (rows.length === 0) {
      toast.error("No barcodes to export");
      return;
    }

    // Generate SVG string for each barcode with larger dimensions for A4
    const labels = rows.map((row) => {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("xmlns", svgNS);
      try {
        JsBarcode(svg, row.barcode, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 14,
          fontOptions: "bold",
          margin: 10,
          background: "#ffffff",
          lineColor: "#000000",
        });
        // Set explicit dimensions for print
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "auto");
      } catch {
        // skip render errors
      }
      return { svgHtml: svg.outerHTML, row };
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Barcode Labels — ${new Date().toLocaleDateString()}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 15px; }
  .label-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6mm;
  }
  .label-item {
    page-break-inside: avoid;
    text-align: center;
    border: 2px solid #333;
    padding: 5mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60mm;
  }
  .label-item svg { max-width: 100%; height: auto; }
  .label-text { font-size: 14px; color: #000; margin-top: 4px; line-height: 1.3; font-weight: 500; }
  .label-text .name { font-weight: bold; font-size: 15px; margin-bottom: 2px; }
  .toolbar { margin-bottom: 15px; }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()" style="padding:10px 24px;font-size:16px;cursor:pointer;">Print Labels</button>
</div>
<div class="label-grid">
${labels
  .map(
    ({ svgHtml, row }) =>
      `  <div class="label-item">
    ${svgHtml}
    <div class="label-text">
      ${row.productName ? `<p class="name">${row.productName}</p>` : ""}
      <p>${row.categoryName} / ${row.colorName} / ${row.sizeName}</p>
    </div>
  </div>`,
  )
  .join("\n")}
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barcode_labels_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Labels HTML downloaded — open it on any computer and print");
  };


  // ── Download table as HTML ──────────────────────────────────
  const handleDownloadTableHTML = () => {
    if (rows.length === 0) {
      toast.error("No barcodes to export");
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Barcode Table — ${new Date().toLocaleDateString()}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 20px; }
  .toolbar { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; font-size: 12px; }
  th { background: #f0f0f0; font-weight: bold; }
  tr:nth-child(even) { background: #f9f9f9; }
  .barcode { font-family: monospace; font-weight: bold; }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()" style="padding:10px 24px;font-size:16px;cursor:pointer;">Print Table</button>
</div>
<h1 style="font-size: 20px; margin-bottom: 8px;">Generated Barcodes — ${new Date().toLocaleDateString()}</h1>
<p style="color: #666; margin-bottom: 20px; font-size: 14px;">Total: ${rows.length} barcode${rows.length !== 1 ? "s" : ""}</p>
<table>
  <thead>
    <tr>
      <th style="width: 40px;">#</th>
      <th>Barcode</th>
      <th>Category</th>
      <th>Color</th>
      <th>Size</th>
      <th style="width: 50px;">Seq</th>
      <th>Product Name</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (row) =>
          `    <tr>
      <td>${row.number}</td>
      <td class="barcode">${row.barcode}</td>
      <td>${row.categoryName}</td>
      <td>${row.colorName}</td>
      <td>${row.sizeName}</td>
      <td style="text-align: center;">${String(row.sequence).padStart(2, "0")}</td>
      <td>${row.productName || ""}</td>
    </tr>`,
      )
      .join("\n")}
  </tbody>
</table>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barcode_table_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Table HTML downloaded — open it on any computer and print");
  };


  // ── Duplicate indicator ─────────────────────────────────────
  const isDuplicate =
    storeId.length === 4 &&
    !!categoryCode &&
    !!colorCode &&
    !!sizeCode &&
    rows.some(
      (r) =>
        r.storeId === storeId &&
        r.categoryCode === categoryCode &&
        r.colorCode === colorCode &&
        r.sizeCode === sizeCode,
    );

  return (
    <div className="min-h-dvh bg-background">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="bg-background border-b no-print">
        <div className="px-4 py-3 flex items-center gap-3 max-w-5xl mx-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/pos")}
            className="h-8 w-8 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-8 w-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Plus className="h-4 w-4 text-white" />
          </div>
          <h1 className="font-bold text-lg">Barcode Generator</h1>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────── */}
      <div className="p-4 max-w-5xl mx-auto no-print">
        {/* Input section */}
        <Card className="mb-4">
          <CardContent className="p-4 space-y-4">
            {/* Store ID */}
            <div className="space-y-2">
              <Label htmlFor="storeId" className="text-sm">
                Store ID (4 digits)
              </Label>
              <Input
                id="storeId"
                value={storeId}
                onChange={(e) => handleStoreIdChange(e.target.value)}
                placeholder="e.g., 4201"
                maxLength={4}
                inputMode="numeric"
                pattern="[0-9]*"
                className="max-w-[200px] h-9 font-mono text-lg tracking-widest"
              />
              <p className="text-xs text-muted-foreground">
                Unique 4-digit identifier for your store. Saved automatically — you only enter it once.
              </p>
            </div>

            {/* Category / Color / Size dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Category</Label>
                <select
                  value={categoryCode}
                  onChange={(e) => setCategoryCode(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Color</Label>
                <select
                  value={colorCode}
                  onChange={(e) => setColorCode(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select color...</option>
                  {COLORS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Size</Label>
                <select
                  value={sizeCode}
                  onChange={(e) => setSizeCode(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select size...</option>
                  {SIZES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Product name + quantity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm">
                  Product Name (optional)
                </Label>
                <Input
                  id="productName"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g., Summer Floral Dress"
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantity" className="text-sm">
                  Quantity (batch generate)
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  max="99"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-9 max-w-[120px]"
                  inputMode="numeric"
                />
              </div>
            </div>

            {/* Duplicate indicator */}
            {isDuplicate && (
              <div className="flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-300"
                >
                  Duplicate combo
                </Badge>
                <span className="text-muted-foreground">
                  Sequence will auto-increment to differentiate items
                </span>
              </div>
            )}

            {/* POS check indicator */}
            {user?.storeId ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isCheckingPOS ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : posInfo ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <AlertCircle className="h-3 w-3 text-muted-foreground" />
                )}
                <span>
                  {isCheckingPOS
                    ? "Checking POS for existing barcodes..."
                    : posInfo
                      ? posInfo.count > 0
                        ? `Found ${posInfo.count} barcode${posInfo.count > 1 ? "s" : ""} in POS → next sequence: ${String(posInfo.nextSeq).padStart(2, "0")}`
                        : "No existing barcodes in POS → next sequence: 01"
                      : "Select all dropdowns to check POS"}
                </span>
              </div>
            ) : (
              storeId.length === 4 && (
                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <AlertCircle className="h-3 w-3" />
                  <span>Not logged in — POS duplicate check disabled. Duplicates possible.</span>
                </div>
              )
            )}

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              className="w-full"
              size="lg"
              disabled={isGenerating || storeId.length !== 4}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isGenerating ? "Generating..." : "Generate Barcode"}
            </Button>
          </CardContent>
        </Card>

        {/* Table section */}
        {rows.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="font-semibold text-sm">
                Generated Barcodes ({rows.length})
              </h2>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCSV}
                >
                  <Download className="h-3 w-3 mr-1" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTableHTML}
                >
                  <FileDown className="h-3 w-3 mr-1" />
                  Table HTML
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadLabelsHTML}
                >
                  <FileDown className="h-3 w-3 mr-1" />
                  Labels HTML
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 font-medium w-10">#</th>
                        <th className="text-left p-2 font-medium">Barcode</th>
                        <th className="text-left p-2 font-medium hidden md:table-cell">Category</th>
                        <th className="text-left p-2 font-medium hidden sm:table-cell">Color</th>
                        <th className="text-left p-2 font-medium hidden sm:table-cell">Size</th>
                        <th className="text-left p-2 font-medium w-12">Seq</th>
                        <th className="text-left p-2 font-medium hidden lg:table-cell">Product Name</th>
                        <th className="text-center p-2 font-medium w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b hover:bg-muted/30 transition-colors"
                        >
                          <td className="p-2 font-mono text-muted-foreground">
                            {row.number}
                          </td>
                          <td className="p-2">
                            <button
                              onClick={() => handleCopy(row.barcode)}
                              className="font-mono hover:text-amber-600 transition-colors"
                              title="Click to copy"
                            >
                              {row.barcode}
                            </button>
                          </td>
                          <td className="p-2 hidden md:table-cell">
                            {row.categoryName}
                          </td>
                          <td className="p-2 hidden sm:table-cell">
                            {row.colorName}
                          </td>
                          <td className="p-2 hidden sm:table-cell">
                            {row.sizeName}
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">
                            {String(row.sequence).padStart(2, "0")}
                          </td>
                          <td className="p-2 text-muted-foreground hidden lg:table-cell">
                            {row.productName || "—"}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="text-red-500 hover:text-red-700 transition-colors inline-flex"
                              title="Delete row"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Barcode structure legend */}
            <div className="mt-3 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
              <p className="font-medium mb-1">Barcode structure (13 digits):</p>
              <p className="font-mono">
                [StoreID 4][Category 2][Color 2][Size 2][Seq 2][Check 1]
              </p>
              <p className="mt-1">
                The last digit is an auto-calculated check digit (standard EAN-13).
                Deleting a row renumbers all subsequent rows and recalculates barcodes.
              </p>
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Plus className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No barcodes generated yet</p>
            <p className="text-xs mt-1">
              Fill in the form above and click Generate Barcode.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}