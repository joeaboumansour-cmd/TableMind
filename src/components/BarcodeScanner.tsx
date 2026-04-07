"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X } from "lucide-react";
import Quagga from "@ericblade/quagga2";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isActive?: boolean;
}

let cachedTargetCameraId: string | null = null;

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isProcessingRef = useRef(false);
  
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");

  const playSuccessSound = useCallback(() => {
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
  }, []);

  const stopTracks = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
  }, []);

  const handleBarcodeDetected = useCallback((barcode: string) => {
    if (isProcessingRef.current || !barcode) return;
    isProcessingRef.current = true;
    
    playSuccessSound();
    onScan(barcode);
    
    setTimeout(() => { 
      isProcessingRef.current = false; 
    }, 2000);
  }, [onScan, playSuccessSound]);

  useEffect(() => {
    if (!isActive || !scannerRef.current) return;
    let isMounted = true;

    const initScanner = async () => {
      try {
        setError(null);
        if (!cachedTargetCameraId) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          const devices = await navigator.mediaDevices.enumerateDevices();
          stream.getTracks().forEach(t => t.stop());
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          const backCameras = videoDevices.filter(d => {
            const label = d.label.toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment');
          });
          cachedTargetCameraId = backCameras.length > 0 
            ? backCameras[backCameras.length - 1].deviceId 
            : videoDevices[0]?.deviceId || null;
        }

        if (!isMounted) return;

        await Quagga.init({
          inputStream: {
            type: "LiveStream",
            target: scannerRef.current!,
            constraints: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              deviceId: cachedTargetCameraId ? { exact: cachedTargetCameraId } : undefined,
              facingMode: "environment",
              aspectRatio: {ideal: 1.7777777778}
            },
            // OPTIMIZATION 2: Target Area (The Patch)
            // This restricts scanning to the middle rectangle only
            area: {
              top: "10%",    // start 30% from top
              right: "10%",  // leave 20% margin on right
              left: "10%",   // leave 20% margin on left
              bottom: "40%"  // end 30% from bottom
            },
          },
          locator: {
              halfSample: false,
              patchSize: "medium"
            },
          decoder: {
            // Keep only what you use to save CPU cycles
            readers: ["ean_reader", "code_128_reader", "upc_reader"]
          },
          locate: true, 
        }, (err) => {
          if (err) throw err;
          if (!isMounted) return;
          Quagga.start();
          setIsScanning(true);
          const video = scannerRef.current?.querySelector('video');
          if (video?.srcObject) activeStreamRef.current = video.srcObject as MediaStream;
        });

        Quagga.onDetected((data) => {
          if (data?.codeResult?.code) handleBarcodeDetected(data.codeResult.code);
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
          <div className="relative bg-zinc-950 aspect-[4/3] sm:h-[280px] w-full overflow-hidden [&_video]:object-cover">
            <div ref={scannerRef} className="w-full h-full" />
            
            {/* HUD Overlay - Adjusted to match the "Patch" area */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Dimm the non-scanned areas */}
                <div className="absolute inset-0 bg-black/40" style={{ clipPath: 'polygon(0% 0%, 0% 100%, 20% 100%, 20% 30%, 80% 30%, 80% 70%, 20% 70%, 20% 100%, 100% 100%, 100% 0%)' }} />
                
                {/* The Target Box */}
                <div className="absolute top-[30%] left-[20%] right-[20%] bottom-[30%] border-2 border-amber-500/50 rounded-lg">
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-amber-500" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-amber-500" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-amber-500" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-amber-500" />
                  
                  {/* Laser Line */}
                  <div className="absolute inset-x-0 top-1/2 h-[1px] bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse" />
                </div>
                
                <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-amber-500 uppercase tracking-widest font-bold">
                  Align Barcode in Box
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
                onKeyDown={(e) => e.key === "Enter" && handleBarcodeDetected(manualBarcode.trim())}
                className="h-10"
              />
              <Button onClick={() => handleBarcodeDetected(manualBarcode.trim())}>Add</Button>
            </div>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-500">Cancel</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}