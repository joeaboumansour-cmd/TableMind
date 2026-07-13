"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X } from "lucide-react";
import Quagga from "@ericblade/quagga2";
import { BrowserMultiFormatReader } from "@zxing/library";

// ============================================================
// BARCODE VALIDATION (Check-digit verification)
// ============================================================

/**
 * EAN-13 / UPC-A check digit validation (Mod 10)
 * UPC-A has 12 digits, EAN-13 has 13 digits
 * EAN-8 has 8 digits
 */
function isValidEAN(barcode: string): boolean {
  const digits = barcode.replace(/\D/g, "");
  let sum = 0;
  let even = digits.length % 2 === 0;

  for (let i = 0; i < digits.length - 1; i++) {
    sum += parseInt(digits[i], 10) * (even ? 3 : 1);
    even = !even;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[digits.length - 1], 10);
}

/**
 * Validate check digit for supported barcode formats
 */
function hasValidCheckDigit(raw: string): boolean {
  const cleaned = raw.replace(/\s/g, "");
  return isValidEAN(cleaned);
}

/**
 * Normalize a raw barcode string:
 * - Strip whitespace
 * - Pad UPC-A (12 digits) to EAN-13 by adding leading 0
 * - Strip leading 0 from EAN-13 that was UPC-A padded
 */
function normalizeBarcode(raw: string): string {
  let code = raw.trim();

  // Strip non-alphanumeric except hyphens (some Code 128 barcodes use them)
  code = code.replace(/[^A-Za-z0-9\-]/g, "");

  return code;
}

// ============================================================
// AGGREGATION CONFIG
// ============================================================

const AGGREGATION_WINDOW_MS = 150; // collect votes for 150ms before flushing
const MIN_VOTES_TO_REPORT = 2; // need at least 2 detections to trust a barcode
const DEDUP_MS = 500; // skip reporting same exact barcode within this window (avoids double-adds)

// ============================================================
// INTERFACES
// ============================================================

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isActive?: boolean;
}

interface BarcodeVote {
  code: string;
  votes: number;
  lastSeen: number;
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
// MAIN COMPONENT
// ============================================================

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const zxingRunningRef = useRef(false);

  // Aggregation buffer
  const votesRef = useRef<Map<string, BarcodeVote>>(new Map());
  const aggregationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Dedup map: prevents same barcode being firehosed
  const recentScansRef = useRef<Map<string, number>>(new Map());

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");

  const stopTracks = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
  }, []);

  const handleBarcodeDetected = useCallback(
    (barcode: string) => {
      onScan(barcode);
    },
    [onScan]
  );

  // ---- Flush aggregation buffer ----
  const flushBuffer = useCallback(() => {
    const votes = votesRef.current;
    if (votes.size === 0) return;

    // Find barcode with most votes
    let bestCode = "";
    let bestVotes = 0;
    const now = Date.now();

    for (const [code, vote] of votes) {
      // Discard votes older than 500ms (stale)
      if (now - vote.lastSeen > 500) continue;
      if (vote.votes > bestVotes) {
        bestVotes = vote.votes;
        bestCode = code;
      }
    }

    votes.clear();

    if (!bestCode || bestVotes < MIN_VOTES_TO_REPORT) return;

    // Normalize
    const normalized = normalizeBarcode(bestCode);

    // Validate check digit (skip for non-EAN formats like Code 128)
    // Only validate if it looks like EAN/UPC (all digits, 8-13 chars)
    if (/^\d{8,13}$/.test(normalized)) {
      if (!hasValidCheckDigit(normalized)) {
        return; // invalid barcode, discard
      }
    }

    // Dedup check: skip if we just reported this barcode
    const dedupMap = recentScansRef.current;
    if (dedupMap.has(normalized)) {
      const lastReported = dedupMap.get(normalized)!;
      if (now - lastReported < DEDUP_MS) {
        return;
      }
    }
    dedupMap.set(normalized, now);

    // Report the barcode
    handleBarcodeDetected(normalized);
  }, [handleBarcodeDetected]);

  // ---- Add vote to buffer ----
  const addVote = useCallback((code: string) => {
    const votes = votesRef.current;
    const existing = votes.get(code);
    if (existing) {
      existing.votes++;
      existing.lastSeen = Date.now();
    } else {
      votes.set(code, { code, votes: 1, lastSeen: Date.now() });
    }
  }, []);

  // ---- Stop ZXing ----
  const stopZxing = useCallback(() => {
    zxingRunningRef.current = false;
    if (zxingReaderRef.current) {
      try {
        zxingReaderRef.current.reset();
      } catch (e) {
        // ignore
      }
      zxingReaderRef.current = null;
    }
  }, []);

  // ---- Start ZXing on the same video element ----
  const startZxing = useCallback(
    (videoElement: HTMLVideoElement) => {
      if (zxingRunningRef.current) return;
      zxingRunningRef.current = true;

      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;

      // Start continuous decode from the existing video element
      reader.decodeFromVideoElementContinuously(videoElement, (result: any, err?: Error) => {
        if (!zxingRunningRef.current) return;
        if (result) {
          const code = result.getText();
          if (code) {
            addVote(code);
          }
        }
      });
    },
    [addVote]
  );

  // ---- Main lifecycle ----
  useEffect(() => {
    if (!isActive || !scannerRef.current) return;
    let isMounted = true;

    // Start the aggregation timer
    aggregationTimerRef.current = setInterval(() => {
      flushBuffer();
    }, AGGREGATION_WINDOW_MS);

    const initScanner = async () => {
      try {
        setError(null);

        // Check MediaDevices API
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const errorMessage = !window.isSecureContext
            ? "Camera access requires a secure connection (HTTPS). Please use HTTPS or localhost."
            : "Your browser does not support camera access. Please use a modern browser.";
          console.error("MediaDevices API not available:", errorMessage);
          if (isMounted) setError(errorMessage);
          return;
        }

        // Get camera ID
        if (!cachedTargetCameraId) {
          let stream: MediaStream | null = null;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
            });
            const devices = await navigator.mediaDevices.enumerateDevices();
            stream.getTracks().forEach((t) => t.stop());
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
          } catch (streamErr: any) {
            console.error("Failed to enumerate camera:", streamErr);
            if (streamErr.name === "NotAllowedError" || streamErr.name === "PermissionDeniedError") {
              if (isMounted) setError("Camera permission denied. Please allow camera access in your browser settings.");
            } else if (streamErr.name === "NotFoundError" || streamErr.name === "DevicesNotFoundError") {
              if (isMounted) setError("No camera device found. Please connect a camera and try again.");
            } else if (streamErr.name === "NotReadableError" || streamErr.name === "TrackStartError") {
              if (isMounted) setError("Camera is already in use by another application. Please close other apps using the camera.");
            } else {
              if (isMounted) setError("Unable to access camera. Please check your device and try again.");
            }
            return;
          }
        }

        if (!isMounted) return;

        // ---- Start Quagga (UI + primary decoder) ----
        await Quagga.init(
          {
            inputStream: {
              type: "LiveStream",
              target: scannerRef.current!,
              constraints: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                deviceId: cachedTargetCameraId
                  ? { exact: cachedTargetCameraId }
                  : undefined,
                facingMode: "environment",
                aspectRatio: { ideal: 1.7777777778 },
              },
              // MAXIMUM COVERAGE: Full frame area
              area: {
                top: "0%",
                right: "0%",
                left: "0%",
                bottom: "0%",
              },
            },
            locator: {
              halfSample: true, // faster processing
              patchSize: "small", // faster than medium
            },
            decoder: {
              // MAXIMUM READERS: Support all common retail barcodes
              readers: [
                "ean_reader",
                "ean_8_reader",
                "upc_reader",
                "code_128_reader",
                "code_39_reader",
                "code_39_vin_reader",
                "codabar_reader",
                "i2of5_reader",
                "2of5_reader",
                "code_93_reader",
              ],
            },
            locate: false, // faster: don't locate, just decode
            numOfWorkers: navigator.hardwareConcurrency || 2, // use all available CPU cores
          },
          (err) => {
            if (err) throw err;
            if (!isMounted) return;

            Quagga.start();
            setIsScanning(true);

            // Grab the video element Quagga created
            const video = scannerRef.current?.querySelector("video");
            if (video) {
              videoRef.current = video;
              if (video.srcObject) {
                activeStreamRef.current = video.srcObject as MediaStream;
              }

              // ---- Start ZXing on the SAME video element (parallel decoder) ----
              // Wait a tiny beat for the stream to be ready
              setTimeout(() => {
                if (isMounted && video.readyState >= 2) {
                  startZxing(video);
                } else if (isMounted) {
                  video.addEventListener("canplay", () => startZxing(video), { once: true });
                }
              }, 100);
            }
          }
        );

        // ---- Quagga detection handler: feed votes to aggregation buffer ----
        Quagga.onProcessed((result) => {
          if (!result || !result.codeResult || !result.codeResult.code) return;
          addVote(result.codeResult.code);
        });

        // Also keep onDetected for extra accuracy (fires less often but more reliable)
        Quagga.onDetected((result) => {
          if (result?.codeResult?.code) {
            // Give it extra votes so it wins in the aggregation
            const code = result.codeResult.code;
            const votes = votesRef.current;
            const existing = votes.get(code);
            if (existing) {
              existing.votes += 3; // detected events are more reliable, give bonus votes
              existing.lastSeen = Date.now();
            } else {
              votes.set(code, { code, votes: 3, lastSeen: Date.now() });
            }
          }
        });
      } catch (err: any) {
        console.error("Scanner Error:", err);
        if (isMounted) setError("Camera error. Please check permissions.");
      }
    };

    const startTimer = setTimeout(initScanner, 200);

    return () => {
      isMounted = false;
      clearTimeout(startTimer);

      // Stop aggregation timer
      if (aggregationTimerRef.current) {
        clearInterval(aggregationTimerRef.current);
        aggregationTimerRef.current = null;
      }

      // Stop ZXing
      stopZxing();

      // Stop Quagga
      Quagga.stop();
      Quagga.offProcessed();
      Quagga.offDetected();

      // Stop camera tracks
      stopTracks();

      // Clear vote buffer
      votesRef.current.clear();
      recentScansRef.current.clear();
    };
  }, [isActive, stopTracks, addVote, flushBuffer, startZxing, stopZxing]);

  if (!isActive) return null;

  return (
    <Card className="w-full border-amber-200/50 shadow-lg overflow-hidden">
      <CardContent className="p-0">
        <div className="relative group">
          <div className="relative bg-zinc-950 aspect-[4/3] sm:h-[280px] w-full overflow-hidden [&_video]:object-cover">
            <div ref={scannerRef} className="w-full h-full" />

            {/* HUD Overlay - Full frame scan indicator */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner brackets - Full Scan */}
                <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-amber-500/60 rounded-tl" />
                <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-amber-500/60 rounded-tr" />
                <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-amber-500/60 rounded-bl" />
                <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-amber-500/60 rounded-br" />

                {/* Scanning grid animation */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-scanTop" />
                <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-scanBottom" />
                <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-transparent via-amber-500 to-transparent animate-scanLeft" />
                <div className="absolute inset-y-0 right-0 w-[2px] bg-gradient-to-b from-transparent via-amber-500 to-transparent animate-scanRight" />

                <p className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-amber-500/70 uppercase tracking-widest font-bold">
                  Scanning full frame
                </p>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/95 p-6 text-center">
                <Camera className="h-10 w-10 text-zinc-700 mb-4" />
                <p className="text-zinc-200 text-sm">{error}</p>
                <Button onClick={() => window.location.reload()}>Restart</Button>
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
                  e.key === "Enter" && handleBarcodeDetected(manualBarcode.trim())
                }
                className="h-10"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <Button onClick={() => handleBarcodeDetected(manualBarcode.trim())}>
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