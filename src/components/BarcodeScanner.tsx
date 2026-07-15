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

/** Interval between BarcodeDetector captures (ms) — Android only */
const CAPTURE_INTERVAL_MS = 150;

/** Fixed canvas size for captures — 640×480 */
const CANVAS_SIZE = 640;

/** Dedup window: short anti-firehose only */
const DEDUP_WINDOW_MS = 500;

/** Retail barcode formats for BarcodeDetector */
const BARCODE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e",
  "code_128", "code_39", "codabar", "itf",
] as const;

// ============================================================
// IOS DETECTION
// ============================================================

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(ua) && "ontouchend" in document)
  );
}

// ============================================================
// PLATFORM-SPECIFIC VIDEO CONSTRAINTS
// ============================================================

/** iOS: 1080p from main wide camera (1×) to get autofocus */
const IOS_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { min: 1280, ideal: 1920 },
  height: { min: 720, ideal: 1080 },
  facingMode: "environment",
  frameRate: { ideal: 30 },
};

/** Android: proven 640×480 config */
const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "environment",
  frameRate: { ideal: 30 },
};

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

function isValidBarcode(raw: string): boolean {
  const n = normalizeBarcode(raw);
  if (!n) return false;
  if (!/^\d{8,13}$/.test(n)) return true;
  return isValidEAN(n);
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const dedupRef = useRef<Map<string, number>>(new Map());
  const barcodeDetectorRef = useRef<any>(null);
  const supportsBarcodeDetector = useRef(false);
  const isMountedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quaggaRef = useRef<any>(null);
  const quaggaInitRef = useRef(false);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [barcodesScanned, setBarcodesScanned] = useState<string[]>([]);

  // ---- Check dedup ----
  const isDuplicate = useCallback((normalized: string): boolean => {
    const now = Date.now();
    const last = dedupRef.current.get(normalized);
    if (last && now - last < DEDUP_WINDOW_MS) return true;
    dedupRef.current.set(normalized, now);
    return false;
  }, []);

  // ---- Report barcode ----
  const reportBarcode = useCallback((barcode: string) => {
    if (isDuplicate(barcode)) return;
    onScan(barcode);
    setBarcodesScanned((prev) => {
      const s = new Set([...prev, barcode]);
      return Array.from(s).slice(-20);
    });
  }, [onScan, isDuplicate]);

  // ---- Draw video frame to canvas (Android only) ----
  const drawFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE * (3 / 4); // 640×480
      canvasRef.current = canvas;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  // ---- Capture + BarcodeDetector (every 150ms) — Android only ----
  const captureLoop = useCallback(() => {
    if (!isMountedRef.current) return;

    const canvas = drawFrame();
    if (!canvas) return;

    if (supportsBarcodeDetector.current && barcodeDetectorRef.current) {
      barcodeDetectorRef.current.detect(canvas).then((results: any[]) => {
        if (!isMountedRef.current) return;
        for (const r of results) {
          if (r.rawValue && isValidBarcode(r.rawValue)) {
            const n = normalizeBarcode(r.rawValue);
            if (n) reportBarcode(n);
          }
        }
      }).catch(() => {});
    }
  }, [drawFrame, reportBarcode]);

  // ---- Start Quagga2 (iOS only) ----
  const startQuagga = useCallback(async (containerEl: HTMLElement) => {
    try {
      const Quagga = (await import("@ericblade/quagga2")).default;
      quaggaRef.current = Quagga;

      const quaggaConfig: any = {
        inputStream: {
          type: "LiveStream",
          target: containerEl,
          constraints: {
            ...(cachedTargetCameraId
              ? { deviceId: { exact: cachedTargetCameraId } }
              : { facingMode: "environment" }),
            width: { min: 1280, ideal: 1920 },
            height: { min: 720, ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        },
        locator: {
          patchSize: "medium",
          halfSample: true,
        },
        numOfWorkers: 0, // 0 = main thread (iOS Chrome has limited Worker support)
        decoder: {
          readers: [
            "ean_reader",
            "ean_8_reader",
            "upc_reader",
            "upc_e_reader",
            "code_128_reader",
            "code_39_reader",
            "codabar_reader",
            "i2of5_reader",
          ],
        },
        frequency: 10, // try to decode ~10 frames per second
      };

      await new Promise<void>((resolve, reject) => {
        Quagga.init(quaggaConfig, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      quaggaInitRef.current = true;
      Quagga.start();

      Quagga.onDetected((result: any) => {
        if (!isMountedRef.current) return;
        if (result && result.codeResult && result.codeResult.code) {
          const raw = result.codeResult.code;
          if (isValidBarcode(raw)) {
            const n = normalizeBarcode(raw);
            if (n) reportBarcode(n);
          }
        }
      });

      setIsScanning(true);
    } catch (err: any) {
      console.error("[Scanner] Quagga error:", err);
      // If Quagga fails, fall back to the Android-style ZXing canvas pipeline
      if (isMountedRef.current) {
        captureTimerRef.current = setInterval(captureLoop, CAPTURE_INTERVAL_MS);
        setIsScanning(true);
      }
    }
  }, [captureLoop, reportBarcode]);

  // ---- Stop Quagga (iOS only) ----
  const stopQuagga = useCallback(() => {
    try {
      if (quaggaRef.current) {
        quaggaRef.current.offDetected();
        quaggaRef.current.stop();
        quaggaRef.current = null;
      }
    } catch {}
    quaggaInitRef.current = false;
  }, []);

  // ---- Start camera ----
  const startCamera = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(!window.isSecureContext ? "Camera requires HTTPS." : "Camera not supported.");
        return;
      }

      if (!cachedTargetCameraId) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          const devices = await navigator.mediaDevices.enumerateDevices();
          tempStream.getTracks().forEach(t => t.stop());
          const videoDevices = devices.filter(d => d.kind === "videoinput");

          if (isIOS()) {
            // iOS: prefer main wide camera, exclude ultra-wide & telephoto
            const mainCamera = videoDevices.find(d => {
              const l = d.label.toLowerCase();
              return !l.includes("ultra") && !l.includes("tele") &&
                (l.includes("back") || l.includes("rear") || l.includes("environment"));
            });
            const anyBack = videoDevices.find(d => {
              const l = d.label.toLowerCase();
              return l.includes("back") || l.includes("rear") || l.includes("environment");
            });
            cachedTargetCameraId = mainCamera?.deviceId || anyBack?.deviceId || videoDevices[0]?.deviceId || null;
          } else {
            // Android: existing logic — pick the last back camera
            const backCameras = videoDevices.filter(d => {
              const l = d.label.toLowerCase();
              return l.includes("back") || l.includes("rear") || l.includes("environment");
            });
            cachedTargetCameraId = backCameras.length > 0 ? backCameras[backCameras.length - 1].deviceId : videoDevices[0]?.deviceId || null;
          }
        } catch {}
      }

      if (isIOS()) {
        // ================================================================
        // iOS PATH: Quagga2 — fast native-feel barcode scanning
        // ================================================================
        // Quagga handles its own video element, camera, and frame processing.
        // It uses optimized image processing that works well on WKWebView.
        // We just give it a container <div> to render into.
        // ================================================================

        if (videoContainerRef.current && isMountedRef.current) {
          // Clear container — Quagga will add its own video + canvas
          videoContainerRef.current.innerHTML = "";
          startQuagga(videoContainerRef.current);
        }
      } else {
        // ================================================================
        // ANDROID PATH: getUserMedia + BarcodeDetector + ZXing canvas
        // ================================================================

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...DEFAULT_VIDEO_CONSTRAINTS,
            deviceId: cachedTargetCameraId ? { exact: cachedTargetCameraId } : undefined,
          },
        });

        if (!isMountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.setAttribute("autoplay", "");
        video.setAttribute("muted", "");
        video.srcObject = stream;
        videoRef.current = video;

        if (videoContainerRef.current) {
          videoContainerRef.current.innerHTML = "";
          videoContainerRef.current.appendChild(video);
        }

        // Init decoders
        if ("BarcodeDetector" in window) {
          try {
            barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats: BARCODE_FORMATS });
            supportsBarcodeDetector.current = true;
          } catch { supportsBarcodeDetector.current = false; }
        }

        const zxing = new BrowserMultiFormatReader();
        zxingReaderRef.current = zxing;

        video.onloadedmetadata = () => video.play().catch(() => {});
        video.oncanplay = () => {
          if (!isMountedRef.current) return;
          setIsScanning(true);
          captureTimerRef.current = setInterval(captureLoop, CAPTURE_INTERVAL_MS);
        };

        // Fallback start after 1s
        setTimeout(() => {
          if (!isMountedRef.current) return;
          if (video.readyState >= 2 && !isScanning) {
            setIsScanning(true);
            captureTimerRef.current = setInterval(captureLoop, CAPTURE_INTERVAL_MS);
          }
        }, 1000);
      }
    } catch (err: any) {
      console.error("[Scanner] Camera error:", err);
      if (!isMountedRef.current) return;
      if (err.name?.includes("NotAllowed") || err.name?.includes("Permission")) setError("Camera permission denied.");
      else if (err.name?.includes("NotFound")) setError("No camera found.");
      else if (err.name?.includes("NotReadable")) setError("Camera in use by another app.");
      else setError("Unable to access camera.");
    }
  }, [captureLoop, startQuagga]);

  // ---- Stop ----
  const stopEverything = useCallback(() => {
    stopQuagga();
    if (captureTimerRef.current) { clearInterval(captureTimerRef.current); captureTimerRef.current = null; }
    if (zxingReaderRef.current) { zxingReaderRef.current.reset(); zxingReaderRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
    if (videoContainerRef.current) videoContainerRef.current.innerHTML = "";
    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    setIsScanning(false);
    setBarcodesScanned([]);
  }, [stopQuagga]);

  // ---- Lifecycle ----
  useEffect(() => {
    isMountedRef.current = isActive;
    if (isActive) startCamera(); else stopEverything();
    return () => { isMountedRef.current = false; stopEverything(); };
  }, [isActive, startCamera, stopEverything]);

  // ---- Manual ----
  const handleManualSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) onScan(trimmed);
    setManualBarcode("");
  }, [onScan]);

  if (!isActive) return null;

  return (
    <Card className="w-full border-amber-200/50 shadow-lg overflow-hidden">
      <CardContent className="p-0">
        <div className="relative group">
          <div className="relative bg-zinc-950 h-[200px] w-full overflow-hidden">
            {isIOS() ? (
              // iOS: Quagga manages the video — no extra <video> element needed
              <div ref={videoContainerRef} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
            ) : (
              // Android: our managed <video> element
              <div ref={videoContainerRef} className="w-full h-full" />
            )}

            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-amber-500/60 rounded-tl" />
                <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-amber-500/60 rounded-tr" />
                <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-amber-500/60 rounded-bl" />
                <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-amber-500/60 rounded-br" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <span className="text-amber-500 text-xs uppercase tracking-widest font-bold">Scanning</span>
                </div>
                {barcodesScanned.length > 0 && (
                  <div className="absolute top-2 right-2 bg-amber-500/80 text-white text-xs px-2 py-0.5 rounded-full">
                    {barcodesScanned.length}
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

          <div className="p-2 dark:bg-zinc-900 flex flex-col gap-2">
            <div className="flex gap-2">
              <Input
                placeholder="Manual barcode..."
                value={manualBarcode}
                onChange={e => setManualBarcode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleManualSubmit(manualBarcode)}
                className="h-8"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <Button size="sm" onClick={() => handleManualSubmit(manualBarcode)}>Add</Button>
            </div>
            {onClose && <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-500">Cancel</Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}