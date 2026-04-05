"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X, Scan } from "lucide-react";
import Quagga from "@ericblade/quagga2";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isActive?: boolean;
}

// Persist the device ID across mounts to skip the "Warm-up" phase on repeated use
let cachedTargetCameraId: string | null = null;

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isProcessingRef = useRef(false);
  
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");

  // Cleanly stops all hardware tracks
  const stopTracks = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
  }, []);

  const handleBarcodeDetected = useCallback((barcode: string) => {
    if (isProcessingRef.current || !barcode) return;
    isProcessingRef.current = true;
    
    onScan(barcode);
    
    // 2-second cooldown to prevent duplicate entries
    setTimeout(() => { 
      isProcessingRef.current = false; 
    }, 2000);
  }, [onScan]);

  useEffect(() => {
    if (!isActive || !scannerRef.current) return;
    
    let isMounted = true;

    const initScanner = async () => {
      try {
        setError(null);

        // 1. Hardware Discovery (Warm-up)
        if (!cachedTargetCameraId) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          const devices = await navigator.mediaDevices.enumerateDevices();
          
          // Immediately release the warm-up stream
          stream.getTracks().forEach(t => t.stop());

          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          const backCameras = videoDevices.filter(d => {
            const label = d.label.toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment');
          });

          // Selection: Prefer the last back camera (usually the primary 1x lens)
          cachedTargetCameraId = backCameras.length > 0 
            ? backCameras[backCameras.length - 1].deviceId 
            : videoDevices[0]?.deviceId || null;
        }

        if (!isMounted) return;

        // 2. Quagga Configuration
        await Quagga.init({
          inputStream: {
            type: "LiveStream",
            target: scannerRef.current!,
            constraints: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              deviceId: cachedTargetCameraId ? { exact: cachedTargetCameraId } : undefined,
              facingMode: "environment"
            },
          },
          decoder: {
            readers: ["ean_reader", "ean_8_reader", "code_128_reader", "code_39_reader", "upc_reader"]
          },
          locate: true,
          frequency: 20,
        }, (err) => {
          if (err) throw err;
          if (!isMounted) return;

          Quagga.start();
          setIsScanning(true);

          // Capture the stream reference for manual cleanup later
          const video = scannerRef.current?.querySelector('video');
          if (video?.srcObject) {
            activeStreamRef.current = video.srcObject as MediaStream;
          }

          // 3. Apply Optical/Hardware Tweaks (Autofocus & Zoom)
          setTimeout(() => {
            const track = Quagga.CameraAccess.getActiveTrack();
            if (track && typeof track.applyConstraints === 'function') {
              const caps = track.getCapabilities() as any;
              const advanced: any[] = [];

              if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
              if (caps.zoom) advanced.push({ zoom: 1.0 });

              if (advanced.length > 0) {
                track.applyConstraints({ advanced }).catch(() => {});
              }
            }
          }, 500);
        });

        Quagga.onDetected((data) => {
          if (data?.codeResult?.code) handleBarcodeDetected(data.codeResult.code);
        });

      } catch (err: any) {
        console.error("Scanner Error:", err);
        if (isMounted) {
          setError(err.name === "NotAllowedError" ? "Camera permission denied." : "Hardware lens unavailable.");
        }
      }
    };

    // Delay start to prevent race conditions with previous unmounts
    const startTimer = setTimeout(initScanner, 200);

    return () => {
      isMounted = false;
      clearTimeout(startTimer);
      Quagga.stop();
      Quagga.offDetected();
      stopTracks();
    };
  }, [isActive, handleBarcodeDetected, stopTracks]);

  if (!isActive) return null;

  return (
    <Card className="w-full border-amber-200/50 shadow-lg overflow-hidden">
      <CardContent className="p-0">
        <div className="relative group">
          {/* Scanner Viewport */}
          <div 
            className="relative bg-zinc-950 aspect-[4/3] sm:h-[280px] w-full overflow-hidden [&_video]:object-cover"
          >
            <div ref={scannerRef} className="w-full h-full" />
            
            {/* HUD Overlay */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none border-[12px] border-black/20">
                <div className="absolute top-6 left-6 w-10 h-10 border-t-4 border-l-4 border-amber-500 rounded-tl-xl" />
                <div className="absolute top-6 right-6 w-10 h-10 border-t-4 border-r-4 border-amber-500 rounded-tr-xl" />
                <div className="absolute bottom-6 left-6 w-10 h-10 border-b-4 border-l-4 border-amber-500 rounded-bl-xl" />
                <div className="absolute bottom-6 right-6 w-10 h-10 border-b-4 border-r-4 border-amber-500 rounded-br-xl" />
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="w-[80%] h-[1px] bg-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse" />
                </div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/95 p-6 text-center">
                <Camera className="h-10 w-10 text-zinc-700 mb-4" />
                <p className="text-zinc-200 text-sm font-medium mb-4 leading-relaxed">{error}</p>
                <Button 
                  size="sm" 
                  variant="secondary" 
                  onClick={() => window.location.reload()}
                  className="bg-amber-500 hover:bg-amber-600 text-white border-none"
                >
                  Restart Scanner
                </Button>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="p-4 dark:bg-zinc-900 flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                placeholder="Type barcode manually..."
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manualBarcode.trim() && onScan(manualBarcode.trim())}
                className="h-10 focus-visible:ring-amber-500"
              />
              <Button 
                onClick={() => manualBarcode.trim() && onScan(manualBarcode.trim())}
                className="bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                Add
              </Button>
            </div>
            
            {onClose && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-zinc-500 text-xs h-7 hover:bg-zinc-100" 
                onClick={onClose}
              >
                Cancel and Close
              </Button>
            )}
          </div>

          {/* Absolute Close Icon for quick exit */}
          {onClose && (
            <Button 
              variant="secondary" 
              size="icon" 
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 text-white border-none backdrop-blur-md" 
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}