"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/library";

// ============================================================
// CONFIG
// ============================================================

/** Interval between snapshot captures (ms) */
const CAPTURE_INTERVAL_MS = 400;

/** Resolution for capture canvas (kept relatively low for performance) */
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

/** Grid tile configuration for fallback ZXing mode */
const GRID_COLS = 3;
const GRID_ROWS = 3;
const TILE_OVERLAP = 100; // px overlap between tiles to catch split barcodes

/** Dedup window: skip reporting same barcode within this many ms */
const DEDUP_WINDOW_MS = 3000;

// ============================================================
// INTERFACES
// ============================================================

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onBatchScan?: (barcodes: string[]) => void;
  onClose?: () => void;
  isActive?: boolean;
}

// ============================================================
// SUCCESS SOUND
// ============================================================

let cachedTargetCameraId: string | null = null;

export const playSuccessSound = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1500, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.07);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.07);

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(60);
    }
  } catch (e) {
    console.warn("Audio feedback failed:", e);
  }
};

// ============================================================
// BARCODE CHECK-DIGIT VALIDATION
// ============================================================

function isValidEAN(barcode: string): boolean {
  const digits = barcode.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 13) return false;
  let sum = 0;
  let even = digits.length % 2 === 0;
  for (let i = 0; i < digits.length - 1; i++) {
    sum += parseInt(digits[i], 10) * (even ? 3 : 1);
    even = !even;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[digits.length - 1], 10);
}

function normalizeBarcode(raw: string): string {
  let code = raw.trim();
  code = code.replace(/[^A-Za-z0-9\-]/g, "");
  // Strip leading zeros from EAN-13 that was originally UPC-A padded
  if (code.length === 13 && code.startsWith("0") && /^\d+$/.test(code)) {
    code = code.slice(1); // treat as UPC-A
  }
  return code;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function BarcodeScanner({
  onScan,
  onBatchScan,
  onClose,
  isActive = true,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dedupRef = useRef<Map<string, number>>(new Map());
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const barcodeDetectorRef = useRef<any>(null); // native BarcodeDetector
  const supportsBarcodeDetector = useRef(false);
  const isMountedRef = useRef(false);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const [barcodesFound, setBarcodesFound] = useState<string[]>([]);

  // ---- Cleanup old dedup entries ----
  const cleanDedup = useCallback(() => {
    const now = Date.now();
    for (const [code, ts] of dedupRef.current) {
      if (now - ts > DEDUP_WINDOW_MS) {
        dedupRef.current.delete(code);
      }
    }
  }, []);

  // ---- Report a batch of barcodes ----
  const reportBarcodes = useCallback(
    (codes: string[]) => {
      if (codes.length === 0) return;

      // Filter by check-digit and dedup
      const now = Date.now();
      const valid: string[] = [];

      for (const raw of codes) {
        const normalized = normalizeBarcode(raw);
        if (!normalized) continue;

        // Validate check digit for EAN/UPC formats
        if (/^\d{8,13}$/.test(normalized)) {
          if (!isValidEAN(normalized)) continue;
        }

        // Dedup
        if (dedupRef.current.has(normalized)) {
          const lastReported = dedupRef.current.get(normalized)!;
          if (now - lastReported < DEDUP_WINDOW_MS) continue;
        }
        dedupRef.current.set(normalized, now);
        valid.push(normalized);
      }

      if (valid.length === 0) return;

      // Report individual barcodes for immediate add
      for (const b of valid) {
        onScan(b);
      }

      // Report batch if handler exists
      if (onBatchScan) {
        onBatchScan(valid);
      }

      // Update found count
      setBarcodesFound((prev) => {
        const unique = new Set([...prev, ...valid]);
        return Array.from(unique).slice(-20); // keep last 20
      });

      // Clean dedup periodically
      cleanDedup();
    },
    [onScan, onBatchScan, cleanDedup]
  );

  // ---- Capture snapshot and detect barcodes ----
  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Ensure video has data
    if (video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw current frame to canvas
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

    // ---- Try native BarcodeDetector ----
    if (supportsBarcodeDetector.current && barcodeDetectorRef.current) {
      try {
        const results = await barcodeDetectorRef.current.detect(canvas);
        const codes: string[] = [];
        for (const r of results) {
          if (r.rawValue) codes.push(r.rawValue);
        }
        if (codes.length > 0) {
          reportBarcodes(codes);
          return; // Success with native API
        }
      } catch (e) {
        // Native API failed, fall through to ZXing
        console.debug("[Scanner] BarcodeDetector failed, falling back to ZXing:", e);
      }
    }

    // ---- Fallback: ZXing grid scan ----
    const reader = zxingReaderRef.current;
    if (!reader) return;

    const tileCodes: string[] = [];
    const tileW = Math.floor((CAPTURE_WIDTH - TILE_OVERLAP * (GRID_COLS - 1)) / GRID_COLS);
    const tileH = Math.floor((CAPTURE_HEIGHT - TILE_OVERLAP * (GRID_ROWS - 1)) / GRID_ROWS);

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        // Skip if component unmounted
        if (!isMountedRef.current) return;

        const sx = Math.floor(col * (tileW + TILE_OVERLAP));
        const sy = Math.floor(row * (tileH + TILE_OVERLAP));

        // Extract tile
        const tileCanvas = document.createElement("canvas");
        tileCanvas.width = tileW;
        tileCanvas.height = tileH;
        const tileCtx = tileCanvas.getContext("2d");
        if (!tileCtx) continue;

        tileCtx.drawImage(canvas, sx, sy, tileW + TILE_OVERLAP, tileH + TILE_OVERLAP, 0, 0, tileW, tileH);

        try {
          // Decode from tile: create a temporary image from the canvas
          const img = new Image();
          img.src = tileCanvas.toDataURL("image/png");
          // Wait for image to load then decode
          await new Promise((resolve) => { img.onload = resolve; });
          const result = await reader.decode(img);
          if (result && result.getText()) {
            tileCodes.push(result.getText());
          }
        } catch {
          // No barcode in this tile, skip
        }
      }
    }

    if (tileCodes.length > 0) {
      reportBarcodes(tileCodes);
    }
  }, [reportBarcodes]);

  // ---- Start camera ----
  const startCamera = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      setError(null);

      // Check MediaDevices API
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const errorMessage = !window.isSecureContext
          ? "Camera access requires a secure connection (HTTPS). Please use HTTPS or localhost."
          : "Your browser does not support camera access.";
        setError(errorMessage);
        return;
      }

      // Get or detect camera
      if (!cachedTargetCameraId) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
          });
          const devices = await navigator.mediaDevices.enumerateDevices();
          tempStream.getTracks().forEach((t) => t.stop());
          const videoDevices = devices.filter((d) => d.kind === "videoinput");
          const backCameras = videoDevices.filter((d) => {
            const label = d.label.toLowerCase();
            return label.includes("back") || label.includes("rear") || label.includes("environment");
          });
          cachedTargetCameraId =
            backCameras.length > 0
              ? backCameras[backCameras.length - 1].deviceId
              : videoDevices[0]?.deviceId || null;
        } catch {
          // Will try without specific camera ID
        }
      }

      // Start stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          deviceId: cachedTargetCameraId ? { exact: cachedTargetCameraId } : undefined,
          facingMode: "environment",
          frameRate: { ideal: 30 },
        },
      });

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      // Attach to video element
      const video = document.createElement("video");
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play().catch(() => {});
      };

      videoRef.current = video;

      // Append to container
      if (videoContainerRef.current) {
        videoContainerRef.current.innerHTML = "";
        videoContainerRef.current.appendChild(video);
      }

      setIsScanning(true);

      // ---- Initialize decoders ----

      // 1. Native BarcodeDetector (Chrome/Edge built-in)
      if ("BarcodeDetector" in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: [
              "ean_13",
              "ean_8",
              "upc_a",
              "upc_e",
              "code_128",
              "code_39",
              "codabar",
              "itf",
              "qr_code",
              "data_matrix",
              "aztec",
              "pdf417",
            ],
          });
          barcodeDetectorRef.current = detector;
          supportsBarcodeDetector.current = true;
          console.log("[Scanner] Using native BarcodeDetector API");
        } catch {
          supportsBarcodeDetector.current = false;
        }
      }

      // 2. ZXing fallback reader
      const zxing = new BrowserMultiFormatReader();
      zxingReaderRef.current = zxing;

      // Create canvas for snapshots
      canvasRef.current = document.createElement("canvas");

      // Wait for video to be ready
      video.oncanplay = () => {
        // Start capture interval
        captureTimerRef.current = setInterval(() => {
          captureAndDetect();
        }, CAPTURE_INTERVAL_MS);
      };
    } catch (err: any) {
      console.error("[Scanner] Camera error:", err);
      if (!isMountedRef.current) return;

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Camera permission denied. Please allow camera access.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found.");
      } else if (err.name === "NotReadableError") {
        setError("Camera is in use by another app.");
      } else {
        setError("Unable to access camera.");
      }
    }
  }, [captureAndDetect]);

  // ---- Stop everything ----
  const stopEverything = useCallback(() => {
    // Stop capture timer
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }

    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Clean up video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    // Clean up container
    if (videoContainerRef.current) {
      videoContainerRef.current.innerHTML = "";
    }

    // Clean up ZXing
    if (zxingReaderRef.current) {
      zxingReaderRef.current.reset();
      zxingReaderRef.current = null;
    }

    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    setIsScanning(false);
    setBarcodesFound([]);
  }, []);

  // ---- Main lifecycle ----
  useEffect(() => {
    isMountedRef.current = isActive;

    if (isActive) {
      startCamera();
    } else {
      stopEverything();
    }

    return () => {
      isMountedRef.current = false;
      stopEverything();
    };
  }, [isActive, startCamera, stopEverything]);

  // ---- Handle manual barcode ----
  const handleManualSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed) onScan(trimmed);
      setManualBarcode("");
    },
    [onScan]
  );

  // ---- Cleanup dedup periodically (outside capture cycle) ----
  useEffect(() => {
    const cleanup = setInterval(() => cleanDedup(), 10000);
    return () => clearInterval(cleanup);
  }, [cleanDedup]);

  if (!isActive) return null;

  return (
    <Card className="w-full border-amber-200/50 shadow-lg overflow-hidden">
      <CardContent className="p-0">
        <div className="relative group">
          <div className="relative bg-zinc-950 aspect-[4/3] sm:h-[280px] w-full overflow-hidden">
            {/* Video container — camera preview, no processing */}
            <div ref={videoContainerRef} className="w-full h-full" />

            {/* Scanning HUD */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner brackets */}
                <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-amber-500/60 rounded-tl" />
                <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-amber-500/60 rounded-tr" />
                <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-amber-500/60 rounded-bl" />
                <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-amber-500/60 rounded-br" />

                {/* Scanning indicator dots */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                    <span className="text-amber-500 text-xs uppercase tracking-widest font-bold">
                      {supportsBarcodeDetector.current ? "Burst Scan" : "Grid Scan"}
                    </span>
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                  </div>
                </div>

                {/* Barcodes found counter */}
                {barcodesFound.length > 0 && (
                  <div className="absolute top-2 right-2 bg-amber-500/80 text-white text-xs px-2 py-0.5 rounded-full pointer-events-auto">
                    {barcodesFound.length} found
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/95 p-6 text-center">
                <Camera className="h-10 w-10 text-zinc-700 mb-4" />
                <p className="text-zinc-200 text-sm mb-3">{error}</p>
                <Button onClick={() => window.location.reload()}>Retry</Button>
              </div>
            )}
          </div>

          <div className="p-4 dark:bg-zinc-900 flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                placeholder="Manual barcode..."
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleManualSubmit(manualBarcode)
                }
                className="h-10"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <Button onClick={() => handleManualSubmit(manualBarcode)}>Add</Button>
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-zinc-500"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}