"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X, Scan } from "lucide-react";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isActive?: boolean;
}

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const scannerRef = useRef<any>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Create beep sound
  const playBeepSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 1000;
      oscillator.type = "sine";
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (err) {
      console.log("Could not play beep sound:", err);
    }
  }, []);

  // Handle barcode detection
  const handleBarcodeDetected = useCallback((barcode: string) => {
    if (barcode !== lastScannedCode) {
      setLastScannedCode(barcode);
      playBeepSound();
      onScan(barcode);
      
      setTimeout(() => {
        setLastScannedCode(null);
      }, 2000);
    }
  }, [lastScannedCode, onScan, playBeepSound]);

  useEffect(() => {
    if (!isActive) return;

    let isMounted = true;

    const startScanner = async () => {
      try {
        if (!isMounted) return;
        setError(null);
        setIsScanning(false);

        // Dynamically import html5-qrcode
        const { Html5Qrcode } = await import("html5-qrcode");
        
        if (!isMounted) return;

        // Create scanner instance
        const scanner = new Html5Qrcode("barcode-scanner");
        scannerRef.current = scanner;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          aspectRatio: 1.0,
          disableFlip: false,
          formatsToSupport: [
            0,  // QR_CODE
            1,  // DATA_MATRIX
            2,  // UPC_A
            3,  // UPC_E
            4,  // EAN_8
            5,  // EAN_13
            6,  // CODE_39
            7,  // CODE_93
            8,  // CODE_128
            10, // ITF
            14, // PDF_417
          ] as any,
        };

        // Start scanning with camera
        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText: string) => {
            handleBarcodeDetected(decodedText);
          },
          (errorMessage: string) => {
            // Ignore scanning errors - they happen frequently during normal operation
          }
        );

        if (isMounted) {
          setIsScanning(true);
          console.log("Barcode scanner started successfully");
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error("Error starting barcode scanner:", err);
        
        if (err.message?.includes("Permission denied") || err.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access and refresh.");
        } else if (err.message?.includes("No camera") || err.name === "NotFoundError") {
          setError("No camera found. Please connect a camera and refresh.");
        } else if (err.message?.includes("in use") || err.name === "NotReadableError") {
          setError("Camera is in use by another application. Please close other apps using the camera.");
        } else {
          setError(`Unable to start scanner: ${err.message || "Unknown error"}. Please try manual entry.`);
        }
        setIsScanning(false);
      }
    };

    const timer = setTimeout(startScanner, 100);

    // Cleanup
    return () => {
      isMounted = false;
      clearTimeout(timer);
      
      if (scannerRef.current) {
        try {
          scannerRef.current.stop().catch(() => {
            // Ignore errors during cleanup
          });
        } catch (err) {
          // Ignore errors during cleanup
        }
        scannerRef.current = null;
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [isActive, handleBarcodeDetected]);

  if (!isActive) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardContent className="p-3">
        <div className="relative">
          {/* Scanner Container */}
          <div className="relative bg-black rounded-lg overflow-hidden">
            {/* Scanner element */}
            <div id="barcode-scanner" className="w-full" style={{ minHeight: "300px" }} />
            
            {/* Scanning Overlay */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner markers */}
                <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-amber-500 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-amber-500 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-amber-500 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-amber-500 rounded-br-lg" />
                
                {/* Status text */}
                <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-auto">
                  <div className="bg-black/60 px-4 py-2 rounded-full text-white text-sm flex items-center gap-2">
                    <Scan className="h-4 w-4" />
                    Point barcode here
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center text-white p-4">
                  <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm mb-4">{error}</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => window.location.reload()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {!isScanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center text-white">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-4" />
                  <p className="text-sm">Starting camera...</p>
                </div>
              </div>
            )}
          </div>

          {/* Manual barcode entry */}
          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Enter barcode manually..."
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualBarcode.trim()) {
                  onScan(manualBarcode.trim());
                  setManualBarcode("");
                }
              }}
              className="h-9"
            />
            <Button 
              variant="outline"
              size="sm"
              onClick={() => {
                if (manualBarcode.trim()) {
                  const trimmedBarcode = manualBarcode.trim();
                  if (trimmedBarcode.length < 4 || trimmedBarcode.length > 20) {
                    alert("Barcode must be between 4 and 20 characters");
                    return;
                  }
                  onScan(trimmedBarcode);
                  setManualBarcode("");
                }
              }}
            >
              Add
            </Button>
          </div>

          {/* Close button */}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 z-10"
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