"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
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
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const scannerContainerId = "barcode-scanner-container";

  // Create beep sound
  const playBeepSound = () => {
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
  };

  useEffect(() => {
    if (!isActive) return;

    const startScanning = async () => {
      try {
        setError(null);
        setIsScanning(true);

        // Create scanner instance
        const html5QrcodeScanner = new Html5Qrcode(scannerContainerId);
        scannerRef.current = html5QrcodeScanner;

        // Start scanning with optimized settings
        await html5QrcodeScanner.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: { width: 250, height: 150 },
            aspectRatio: 1.777778,
            disableFlip: false,
          },
          (decodedText, decodedResult) => {
            // Avoid duplicate scans
            if (decodedText !== lastScannedCode) {
              setLastScannedCode(decodedText);
              playBeepSound();
              onScan(decodedText);
              
              // Reset last scanned code after 2 seconds
              setTimeout(() => {
                setLastScannedCode(null);
              }, 2000);
            }
          },
          (errorMessage) => {
            // Ignore NotFoundException errors - normal when no barcode in frame
            if (!errorMessage.includes("NotFoundException")) {
              console.log("Scan error:", errorMessage);
            }
          }
        );
      } catch (err: any) {
        console.error("Error starting barcode scanner:", err);
        if (err.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access in your browser settings and refresh the page.");
        } else if (err.name === "NotFoundError") {
          setError("No camera found. Please connect a camera and refresh the page.");
        } else if (err.name === "NotReadableError") {
          setError("Camera is in use by another application. Please close other apps using the camera and try again.");
        } else {
          setError("Unable to access camera. Please check your browser permissions.");
        }
        setIsScanning(false);
      }
    };

    // Small delay to ensure DOM element is ready
    const timer = setTimeout(() => {
      startScanning();
    }, 100);

    // Cleanup
    return () => {
      clearTimeout(timer);
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch((err) => {
          console.log("Error stopping scanner:", err);
        });
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [isActive, onScan]);

  if (!isActive) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardContent className="p-3">
        <div className="relative">
          {/* Scanner Container */}
          <div className="relative bg-black rounded-lg overflow-hidden">
            <div id={scannerContainerId} className="w-full" />
            
            {/* Scanning Overlay */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner markers */}
                <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-amber-500 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-amber-500 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-amber-500 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-amber-500 rounded-br-lg" />
                
                {/* Status text */}
                <div className="absolute bottom-4 inset-x-0 flex justify-center">
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
                  <p className="text-sm">{error}</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4"
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
              placeholder="Enter barcode..."
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
        </div>
      </CardContent>
    </Card>
  );
}