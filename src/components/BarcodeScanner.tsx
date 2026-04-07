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

  // --- NEW: SYNTHETIC BEEP GENERATOR ---
  // This avoids loading external MP3 files and works instantly
  const playSuccessSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create nodes
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // --- TUNING FOR AUTHENTICITY ---
      // 'square' sounds like an old-school electronic beep
      // 'triangle' is a bit cleaner but still sharp
      oscillator.type = "square"; 
      
      // Frequency: 1500Hz is a sharp, piercing "chirp"
      oscillator.frequency.setValueAtTime(1500, audioCtx.currentTime); 
      
      // Volume: Start at 0.1 (not too loud), then drop to 0 instantly
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      
      // The "Snap": Cutting the sound off at 0.07 seconds makes it a "click" or "chirp"
      // rather than a "beeeeeep"
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.07);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.07);

      // Haptic feedback
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(60); // Short pulse for a "click" feel
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
    
    // Play the beep immediately on detection
    playSuccessSound();
    
    onScan(barcode);
    
    setTimeout(() => { 
      isProcessingRef.current = false; 
    }, 2000);
  }, [onScan, playSuccessSound]);

  // ... rest of your useEffect logic (stays the same) ...

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
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}