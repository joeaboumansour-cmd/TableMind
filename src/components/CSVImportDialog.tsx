"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  X,
  Download,
  Loader2,
  Info,
} from "lucide-react";
import {
  parseCSV,
  downloadCSV,
  generateCSVTemplate,
  validateImportLimits,
  type ProductCSVRow,
  type ValidationError,
} from "@/lib/csv/utils";

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  onImportComplete: () => void;
}

type ImportMode = "upsert" | "create_only" | "replace_all";

interface ImportResult {
  total: number;
  successful: number;
  failed: number;
  updated: number;
  created: number;
}

export default function CSVImportDialog({
  open,
  onOpenChange,
  storeId,
  onImportComplete,
}: CSVImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");
  const [parsedData, setParsedData] = useState<ProductCSVRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("upsert");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === "text/csv") {
      processFile(droppedFile);
    } else {
      toast.error("Please drop a CSV file");
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const processFile = (selectedFile: File) => {
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error("File size must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCsvContent(content);
      setFile(selectedFile);
      parseAndValidate(content);
    };
    reader.readAsText(selectedFile);
  };

  const parseAndValidate = (content: string) => {
    const result = parseCSV(content);
    setParsedData(result.data);
    setValidationErrors(result.errors);

    // Check import limits
    const limitCheck = validateImportLimits(result.data.length);
    if (!limitCheck.valid) {
      toast.error(limitCheck.message);
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) {
      toast.error("No valid data to import");
      return;
    }

    setIsImporting(true);
    setImportProgress({ current: 0, total: parsedData.length });

    try {
      // Use smaller batches for reliability
      const BATCH_SIZE = 100;
      const batches: ProductCSVRow[][] = [];
      
      // Split products into batches
      for (let i = 0; i < parsedData.length; i += BATCH_SIZE) {
        batches.push(parsedData.slice(i, i + BATCH_SIZE));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;
      let totalUpdated = 0;
      let totalCreated = 0;
      const allErrors: Array<{ row: number; message: string }> = [];

      console.log(`Starting import of ${parsedData.length} products in ${batches.length} batches`);

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchStartRow = batchIndex * BATCH_SIZE + 1;

        console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} products)`);
        toast.info(`Importing batch ${batchIndex + 1} of ${batches.length}...`);

        // Add timeout to detect silent failures
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        try {
          const response = await fetch("/api/products/import", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              products: batch,
              mode: importMode,
              storeId,
              fileName: file?.name,
              fileSize: file?.size,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          console.log(`Batch ${batchIndex + 1} response status:`, response.status);

          if (!response.ok) {
            const errorResult = await response.json();
            console.error(`Batch ${batchIndex + 1} error:`, errorResult);
            throw new Error(errorResult.error || `Batch ${batchIndex + 1} failed`);
          }

          const result = await response.json();
          console.log(`Batch ${batchIndex + 1} result:`, result.summary);

          // Aggregate results
          totalSuccessful += result.summary.successful;
          totalFailed += result.summary.failed;
          totalUpdated += result.summary.updated;
          totalCreated += result.summary.created;
          
          // Collect errors
          if (result.errors) {
            result.errors.forEach((err: { row: number; message: string }) => {
              allErrors.push({
                row: err.row + batchStartRow - 1,
                message: err.message,
              });
            });
          }

          // Update progress
          setImportProgress({
            current: Math.min((batchIndex + 1) * BATCH_SIZE, parsedData.length),
            total: parsedData.length,
          });
        } catch (error: any) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            console.error(`Batch ${batchIndex + 1} timed out after 60 seconds`);
            throw new Error(`Import timed out on batch ${batchIndex + 1}. The server may be overloaded.`);
          }
          throw error;
        }
      }

      console.log(`Import complete:`, { totalSuccessful, totalFailed, totalUpdated, totalCreated });

      const summary = {
        total: parsedData.length,
        successful: totalSuccessful,
        failed: totalFailed,
        updated: totalUpdated,
        created: totalCreated,
      };

      setImportResult(summary);
      toast.success(
        `Import complete! ${totalSuccessful} products ${importMode === "upsert" ? "processed" : "imported"}`
      );

      onImportComplete();
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error(error.message || "Failed to import products");
    } finally {
      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });
    }
  };

  const handleDownloadTemplate = () => {
    const template = generateCSVTemplate();
    downloadCSV(template, "products_template");
    toast.success("Template downloaded");
  };

  const handleDownloadErrors = () => {
    if (validationErrors.length === 0) return;

    const errorRows = validationErrors.map((err) => ({
      row: err.row,
      field: err.field,
      message: err.message,
    }));

    const csv = [
      ["Row", "Field", "Error Message"],
      ...errorRows.map((err) => [err.row.toString(), err.field, err.message]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    downloadCSV(csv, "import_errors");
    toast.success("Error report downloaded");
  };

  const resetDialog = () => {
    setFile(null);
    setCsvContent("");
    setParsedData([]);
    setValidationErrors([]);
    setImportResult(null);
    setShowErrors(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetDialog();
    }
    onOpenChange(newOpen);
  };

  const getModeDescription = (mode: ImportMode) => {
    switch (mode) {
      case "upsert":
        return "Update existing products (by ID or barcode) and create new ones. Stock quantities will be added to existing stock.";
      case "create_only":
        return "Only create new products. Skip any products that already exist.";
      case "replace_all":
        return "⚠️ Delete ALL existing products and import from CSV. This action cannot be undone!";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Products from CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk import or update your products.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Download Template */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Download CSV Template</p>
                <p className="text-xs text-muted-foreground">
                  Use this template to ensure correct format
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              className="gap-1"
            >
              <Download className="h-4 w-4" />
              Template
            </Button>
          </div>

          {/* File Drop Zone */}
          {!file && (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                Drag and drop your CSV file here
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                or click to browse (max 5MB)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </Button>
            </div>
          )}

          {/* File Selected */}
          {file && !importResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    setCsvContent("");
                    setParsedData([]);
                    setValidationErrors([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Validation Summary */}
              {parsedData.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {validationErrors.length === 0 ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                    )}
                    <span className="text-sm font-medium">
                      {parsedData.length} valid rows
                      {validationErrors.length > 0 && (
                        <span className="text-amber-600">
                          {" "}
                          • {validationErrors.length} errors
                        </span>
                      )}
                    </span>
                  </div>

                  {validationErrors.length > 0 && (
                    <div className="space-y-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 h-auto"
                        onClick={() => setShowErrors(!showErrors)}
                      >
                        {showErrors ? "Hide" : "Show"} errors (
                        {validationErrors.length})
                      </Button>

                      {showErrors && (
                        <div className="max-h-40 overflow-y-auto text-xs space-y-1 p-2 bg-destructive/10 rounded">
                          {validationErrors.slice(0, 20).map((err, i) => (
                            <div key={i} className="text-destructive">
                              Row {err.row}: {err.field} - {err.message}
                            </div>
                          ))}
                          {validationErrors.length > 20 && (
                            <div className="text-muted-foreground">
                              ...and {validationErrors.length - 20} more errors
                            </div>
                          )}
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadErrors}
                        className="gap-1"
                      >
                        <Download className="h-3 w-3" />
                        Download error report
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Preview Table */}
              {parsedData.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Preview (first 5 rows):</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-2 text-left">Name</th>
                          <th className="p-2 text-left">Barcode</th>
                          <th className="p-2 text-right">Cost</th>
                          <th className="p-2 text-right">Sell</th>
                          <th className="p-2 text-left">Curr</th>
                          <th className="p-2 text-right">Stock</th>
                          <th className="p-2 text-left">Variant</th>
                          <th className="p-2 text-left">Parent ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedData.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-2 truncate max-w-[120px]">
                              {row.name}
                            </td>
                            <td className="p-2 font-mono">
                              {row.barcode || "-"}
                            </td>
                            <td className="p-2 text-right">
                              {row.cost_price.toFixed(2)}
                            </td>
                            <td className="p-2 text-right">
                              {row.selling_price.toFixed(2)}
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-[10px] px-1">
                                {row.currency}
                              </Badge>
                            </td>
                            <td className="p-2 text-right">
                              {row.stock_quantity}
                            </td>
                            <td className="p-2 truncate max-w-[80px]">
                              {row.variant_name || "-"}
                            </td>
                            <td className="p-2 font-mono truncate max-w-[80px]">
                              {row.parent_id ? row.parent_id.substring(0, 8) + '...' : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedData.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      ...and {parsedData.length - 5} more rows
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Import Mode Selection */}
          {(parsedData.length > 0 || importResult) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Import Mode</span>
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="radio"
                    name="importMode"
                    value="upsert"
                    checked={importMode === "upsert"}
                    onChange={() => setImportMode("upsert")}
                    className="mt-1"
                    disabled={isImporting}
                  />
                  <div>
                    <span className="text-sm font-medium">Upsert (Recommended)</span>
                    <p className="text-xs text-muted-foreground">
                      {getModeDescription("upsert")}
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="radio"
                    name="importMode"
                    value="create_only"
                    checked={importMode === "create_only"}
                    onChange={() => setImportMode("create_only")}
                    className="mt-1"
                    disabled={isImporting}
                  />
                  <div>
                    <span className="text-sm font-medium">Create Only</span>
                    <p className="text-xs text-muted-foreground">
                      {getModeDescription("create_only")}
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-red-200 rounded-lg cursor-pointer hover:bg-red-50 transition-colors">
                  <input
                    type="radio"
                    name="importMode"
                    value="replace_all"
                    checked={importMode === "replace_all"}
                    onChange={() => setImportMode("replace_all")}
                    className="mt-1"
                    disabled={isImporting}
                  />
                  <div>
                    <span className="text-sm font-medium text-red-600">
                      Replace All
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {getModeDescription("replace_all")}
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Import Result */}
          {importResult && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-800">
                  Import Completed Successfully!
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total:</span>
                  <span className="ml-2 font-medium">{importResult.total}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Successful:</span>
                  <span className="ml-2 font-medium text-green-600">
                    {importResult.successful}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Failed:</span>
                  <span className="ml-2 font-medium text-red-600">
                    {importResult.failed}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Updated:</span>
                  <span className="ml-2 font-medium text-blue-600">
                    {importResult.updated}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <span className="ml-2 font-medium text-blue-600">
                    {importResult.created}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {isImporting && importProgress.total > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Importing...</span>
              <span className="font-medium">
                {importProgress.current} / {importProgress.total}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(importProgress.current / importProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {importResult ? (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={
                  isImporting ||
                  parsedData.length === 0 ||
                  validationErrors.length > 0
                }
                className="gap-2"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {parsedData.length > 0 ? `(${parsedData.length} products)` : ""}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}