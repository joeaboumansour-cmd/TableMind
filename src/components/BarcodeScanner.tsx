"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/library";

// ============================================================
// CONFIG — shared (both platforms)
// ============================================================

/** Interval between BarcodeDetector captures (ms) — Android only */
const CAPTURE_INTERVAL_MS = 150;

/** Fixed canvas size for captures — 640×480 is fast and enough for barcodes */
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

/**
 * iOS: clean 1080p from main wide camera (1×) — no zoom, no advanced.
 * The key is just getting the right camera with autofocus.
 */
const IOS_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { min: 1280, ideal: 1920 },
  height: { min: 720, ideal: 1080 },
  facingMode: "environment",
  frameRate: { ideal: 30 },
};

/** Android: proven 640×480 config — don't touch. */
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
  /** Track whether iOS ZXing continuous decode has been started */
  const iosZxingStartedRef = useRef(false);

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

  // ---- Draw video frame to canvas (Android / fallback) ----
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

      const videoConstraints = {
        ...(isIOS() ? IOS_VIDEO_CONSTRAINTS : DEFAULT_VIDEO_CONSTRAINTS),
        deviceId: cachedTargetCameraId ? { exact: cachedTargetCameraId } : undefined,
      };

      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

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
        setIsScanning(true);

        if (isIOS()) {
          // ================================================================
          // iOS PATH: ZXing decodeFromVideoElement — continuous, native-speed
          // ================================================================
          // ZXing captures frames directly from the <video> element using its
          // own internal canvas. No toDataURL, no Image()—dramatically faster.
          // ================================================================
          iosZxingStartedRef.current = false;
          const startIOSDecode = () => {
            if (!isMountedRef.current || iosZxingStartedRef.current) return;
            iosZxingStartedRef.current = true;
            zxing.decodeFromVideoElementContinuously(
              videoRef.current!,
              (result: any) => {
                if (!isMountedRef.current) return;
                if (result && result.getText()) {
                  const raw = result.getText();
                  if (isValidBarcode(raw)) {
                    const n = normalizeBarcode(raw);
                    if (n) reportBarcode(n);
                  }
                }
              }
            );
          };

          // Give video a moment to reach readyState >= 2
          if (video.readyState >= 2) {
            startIOSDecode();
          } else {
            video.addEventListener("canplay", startIOSDecode, { once: true });
          }
        } else {
          // ================================================================
          // ANDROID PATH: BarcodeDetector timer + ZXing canvas fallback timer
          // ================================================================
          captureTimerRef.current = setInterval(captureLoop, CAPTURE_INTERVAL_MS);
        }
      };

      // Fallback start after 1s (both platforms)
      setTimeout(() => {
        if (!isMountedRef.current) return;
        if (video.readyState >= 2 && !isScanning) {
          setIsScanning(true);
          captureTimerRef.current = setInterval(captureLoop, CAPTURE_INTERVAL_MS);
        }
      }, 1000);
    } catch (err: any) {
      console.error("[Scanner] Camera error:", err);
      if (!isMountedRef.current) return;
      if (err.name?.includes("NotAllowed") || err.name?.includes("Permission")) setError("Camera permission denied.");
      else if (err.name?.includes("NotFound")) setError("No camera found.");
      else if (err.name?.includes("NotReadable")) setError("Camera in use by another app.");
      else setError("Unable to access camera.");
    }
  }, [captureLoop, reportBarcode]);

  // ---- Stop ----
  const stopEverything = useCallback(() => {
    if (captureTimerRef.current) { clearInterval(captureTimerRef.current); captureTimerRef.current = null; }
    if (zxingReaderRef.current) { zxingReaderRef.current.reset(); zxingReaderRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
    if (videoContainerRef.current) videoContainerRef.current.innerHTML = "";
    barcodeDetectorRef.current = null;
    canvasRef.current = null;
    iosZxingStartedRef.current = false;
    setIsScanning(false);
    setBarcodesScanned([]);
  }, []);

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
            <div ref={videoContainerRef} className="w-full h-full" />

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