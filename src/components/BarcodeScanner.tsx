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

/** Min interval between decode attempts (prevents CPU saturation) */
const MIN_DECODE_INTERVAL_MS = 120;

/** Resolution for capture canvas */
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

/** Dedup window: skip reporting same barcode within this many ms */
const DEDUP_WINDOW_MS = 3000;

/** Only these retail barcode formats — reduces BarcodeDetector latency */
const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "codabar",
  "itf",
] as const;

// ============================================================
// INTERFACES
// ============================================================

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
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
  if (code.length === 13 && code.startsWith("0") && /^\d+$/.test(code)) {
    code = code.slice(1);
  }
  return code;
}

// ============================================================
// IS VALID BARCODE
// ============================================================

function isValidBarcode(raw: string): boolean {
  const normalized = normalizeBarcode(raw);
  if (!normalized) return false;
  if (!/^\d{8,13}$/.test(normalized)) return true; // non-EAN passes through
  return isValidEAN(normalized);
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function BarcodeScanner({
  onScan,
  onClose,
  isActive = true,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dedupRef = useRef<Map<string, number>>(new Map());
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const barcodeDetectorRef = useRef<any>(null);
  const supportsBarcodeDetector = useRef(false);
  const isMountedRef = useRef(false);
  const lastDecodeTimeRef = useRef(0);
  const zxingBusyRef = useRef(false);
  const animFrameIdRef = useRef<number>(0);
  const decodedBarcodesRef = useRef<string[]>([]);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const [barcodesFound, setBarcodesFound] = useState<string[]>([]);

  // ---- Dedup check ----
  const isDuplicate = useCallback((normalized: string): boolean => {
    const now = Date.now();
    const lastReported = dedupRef.current.get(normalized);
    if (lastReported && now - lastReported < DEDUP_WINDOW_MS) {
      return true;
    }
    dedupRef.current.set(normalized, now);
    return false;
  }, []);

  // ---- Report barcode ----
  const reportBarcode = useCallback(
    (barcode: string) => {
      if (isDuplicate(barcode)) return;
      onScan(barcode);
      setBarcodesFound((prev) => {
        const unique = new Set([...prev, barcode]);
        return Array.from(unique).slice(-20);
      });
    },
    [onScan, isDuplicate]
  );

  // ---- Clean dedup ----
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [code, ts] of dedupRef.current) {
        if (now - ts > DEDUP_WINDOW_MS * 2) {
          dedupRef.current.delete(code);
        }
      }
    }, 10000);
    return () => clearInterval(cleanup);
  }, []);

  // ============================================================
  // THE CORE LOOP — runs per video frame via requestAnimationFrame
  // ============================================================
  const decodeLoop = useCallback(() => {
    if (!isMountedRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      return;
    }

    // Wait for video to have a frame
    if (video.readyState < 2 || video.videoWidth === 0) {
      animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      return;
    }

    // Throttle: don't decode too often
    const now = Date.now();
    if (now - lastDecodeTimeRef.current < MIN_DECODE_INTERVAL_MS) {
      animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      return;
    }

    // If ZXing is still busy, skip this frame
    if (zxingBusyRef.current) {
      animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      return;
    }

    lastDecodeTimeRef.current = now;

    // ---- Draw frame to canvas (sharp, no smoothing) ----
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      return;
    }

    canvas.width = video.videoWidth || CAPTURE_WIDTH;
    canvas.height = video.videoHeight || CAPTURE_HEIGHT;
    ctx.imageSmoothingEnabled = false; // SHARP pixels — critical for distance
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // ---- Try BarcodeDetector (near-zero CPU, hardware accelerated) ----
    if (supportsBarcodeDetector.current && barcodeDetectorRef.current) {
      barcodeDetectorRef.current
        .detect(canvas)
        .then((results: any[]) => {
          if (!isMountedRef.current) return;
          let foundOne = false;
          for (const r of results) {
            if (r.rawValue && isValidBarcode(r.rawValue)) {
              const normalized = normalizeBarcode(r.rawValue);
              if (normalized && !isDuplicate(normalized)) {
                foundOne = true;
                reportBarcode(normalized);
              }
            }
          }
          // If BarcodeDetector found something, skip ZXing fallback this frame
          if (!foundOne && zxingReaderRef.current) {
            tryZxingDecode(canvas, ctx);
          }
        })
        .catch(() => {
          if (zxingReaderRef.current) {
            tryZxingDecode(canvas, ctx);
          }
        })
        .finally(() => {
          animFrameIdRef.current = requestAnimationFrame(decodeLoop);
        });
      return;
    }

    // ---- No BarcodeDetector: use ZXing directly ----
    if (zxingReaderRef.current) {
      tryZxingDecode(canvas, ctx);
    }

    animFrameIdRef.current = requestAnimationFrame(decodeLoop);
  }, [reportBarcode, isDuplicate]);

  // ---- ZXing single-frame decode ----
  const tryZxingDecode = useCallback(
    (canvas: HTMLCanvasElement, _ctx: CanvasRenderingContext2D) => {
      if (zxingBusyRef.current || !zxingReaderRef.current) return;
      zxingBusyRef.current = true;

      const reader = zxingReaderRef.current;

      // Use toBlob (async, no PNG compression) instead of toDataURL
      canvas.toBlob((blob) => {
        if (!blob || !isMountedRef.current) {
          zxingBusyRef.current = false;
          return;
        }

        const img = new Image();
        img.onload = () => {
          if (!isMountedRef.current) {
            zxingBusyRef.current = false;
            return;
          }
          try {
            const result = reader.decode(img);
            if (result && result.getText()) {
              const raw = result.getText();
              if (isValidBarcode(raw)) {
                const normalized = normalizeBarcode(raw);
                if (normalized) {
                  reportBarcode(normalized);
                }
              }
            }
          } catch {
            // No barcode found — normal
          } finally {
            zxingBusyRef.current = false;
            URL.revokeObjectURL(img.src);
          }
        };
        img.onerror = () => {
          zxingBusyRef.current = false;
        };
        img.src = URL.createObjectURL(blob);
      }, "image/jpeg"); // JPEG is much faster than PNG for canvas-to-blob
    },
    [reportBarcode]
  );

  // ---- Start camera ----
  const startCamera = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      setError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(
          !window.isSecureContext
            ? "Camera requires HTTPS."
            : "Camera not supported in this browser."
        );
        return;
      }

      // Get camera ID
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
            return (
              label.includes("back") ||
              label.includes("rear") ||
              label.includes("environment")
            );
          });
          cachedTargetCameraId =
            backCameras.length > 0
              ? backCameras[backCameras.length - 1].deviceId
              : videoDevices[0]?.deviceId || null;
        } catch {
          // Continue without specific ID
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          deviceId: cachedTargetCameraId
            ? { exact: cachedTargetCameraId }
            : undefined,
          facingMode: "environment",
          frameRate: { ideal: 30 },
        },
      });

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      // Create video element
      const video = document.createElement("video");
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.srcObject = stream;

      videoRef.current = video;

      // Append to container
      if (videoContainerRef.current) {
        videoContainerRef.current.innerHTML = "";
        videoContainerRef.current.appendChild(video);
      }

      // Initialize decoders
      if ("BarcodeDetector" in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: BARCODE_FORMATS,
          });
          barcodeDetectorRef.current = detector;
          supportsBarcodeDetector.current = true;
        } catch {
          supportsBarcodeDetector.current = false;
        }
      }

      const zxing = new BrowserMultiFormatReader();
      zxingReaderRef.current = zxing;

      // Create canvas
      const canvas = document.createElement("canvas");
      canvasRef.current = canvas;

      // Wait for video to be ready then start loop
      video.onloadedmetadata = () => {
        video.play().catch(() => {});
      };

      video.oncanplay = () => {
        setIsScanning(true);
        // Start the main decode loop
        animFrameIdRef.current = requestAnimationFrame(decodeLoop);
      };

      // Fallback if oncanplay doesn't fire
      setTimeout(() => {
        if (!isMountedRef.current) return;
        if (video.readyState >= 2 && !isScanning) {
          setIsScanning(true);
          animFrameIdRef.current = requestAnimationFrame(decodeLoop);
        }
      }, 1000);
    } catch (err: any) {
      console.error("[Scanner] Camera error:", err);
      if (!isMountedRef.current) return;

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Camera permission denied.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found.");
      } else if (err.name === "NotReadableError") {
        setError("Camera in use by another app.");
      } else {
        setError("Unable to access camera.");
      }
    }
  }, [decodeLoop]);

  // ---- Stop everything ----
  const stopEverything = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = 0;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    if (videoContainerRef.current) {
      videoContainerRef.current.innerHTML = "";
    }

    if (zxingReaderRef.current) {
      zxingReaderRef.current.reset();
      zxingReaderRef.current = null;
    }

    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    zxingBusyRef.current = false;
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

  // ---- Manual barcode ----
  const handleManualSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed) onScan(trimmed);
      setManualBarcode("");
    },
    [onScan]
  );

  if (!isActive) return null;

  return (
    <Card className="w-full border-amber-200/50 shadow-lg overflow-hidden">
      <CardContent className="p-0">
        <div className="relative group">
          <div className="relative bg-zinc-950 aspect-[4/3] sm:h-[280px] w-full overflow-hidden">
            <div ref={videoContainerRef} className="w-full h-full" />

            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-amber-500/60 rounded-tl" />
                <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-amber-500/60 rounded-tr" />
                <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-amber-500/60 rounded-bl" />
                <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-amber-500/60 rounded-br" />

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                    <span className="text-amber-500 text-xs uppercase tracking-widest font-bold">
                      {supportsBarcodeDetector.current
                        ? "Scanning"
                        : "Scanning"}
                    </span>
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                  </div>
                </div>

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
              <Button onClick={() => handleManualSubmit(manualBarcode)}>
                Add
              </Button>
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