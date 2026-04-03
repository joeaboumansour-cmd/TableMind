"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X, Scan, Zap } from "lucide-react";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isActive?: boolean;
}

export default function BarcodeScanner({ onScan, onClose, isActive = true }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const [torchEnabled, setTorchEnabled] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scannerContainerId = "barcode-scanner-container";
  const animationFrameRef = useRef<number | null>(null);
  const barcodeDetectorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
  }, [lastScannedCode, onScan]);

  // Toggle torch/flash
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      
      if (capabilities.torch) {
        await track.applyConstraints({
          advanced: [{ torch: !torchEnabled } as any]
        });
        setTorchEnabled(!torchEnabled);
      }
    } catch (err) {
      console.log("Torch not supported:", err);
    }
  }, [torchEnabled]);

  // Handle tap to focus
  const handleTapToFocus = useCallback(async (e: React.TouchEvent | React.MouseEvent) => {
    if (!streamRef.current || !videoRef.current) return;
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      
      if (capabilities.focusMode) {
        // Get tap position relative to video
        const rect = videoRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        // Trigger focus
        await track.applyConstraints({
          advanced: [{ focusMode: 'single-shot' } as any]
        });
        
        // Return to continuous focus after a delay
        setTimeout(async () => {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as any]
            });
          } catch (err) {
            console.log("Error returning to continuous focus:", err);
          }
        }, 1000);
      }
    } catch (err) {
      console.log("Tap to focus not supported:", err);
    }
  }, []);

  // Native BarcodeDetector scanning loop
  const scanWithNativeDetector = useCallback(async () => {
    if (!barcodeDetectorRef.current || !videoRef.current) return;
    
    try {
      const barcodes = await barcodeDetectorRef.current.detect(videoRef.current);
      if (barcodes.length > 0) {
        handleBarcodeDetected(barcodes[0].rawValue);
      }
    } catch (err) {
      // Ignore detection errors
    }
    
    if (isScanning) {
      animationFrameRef.current = requestAnimationFrame(scanWithNativeDetector);
    }
  }, [isScanning, handleBarcodeDetected]);

  useEffect(() => {
    if (!isActive) return;

    const startScanning = async () => {
      try {
        setError(null);
        setIsScanning(true);

        // Check for native BarcodeDetector support
        const hasNativeSupport = 'BarcodeDetector' in window;
        
        // Request camera with advanced constraints for mobile
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
            frameRate: { ideal: 30, min: 15 },
            // Advanced constraints for better mobile performance
            ...(hasNativeSupport && {
              advanced: [
                { focusMode: 'continuous' },
                { focusDistance: { min: 0, ideal: 0.15, max: 0.5 } },
                { exposureMode: 'continuous' },
                { whiteBalanceMode: 'continuous' },
              ] as any
            })
          }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        
        if (hasNativeSupport) {
          console.log("Using native BarcodeDetector API");
          
          // Create BarcodeDetector instance
          const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'qr_code', 'data_matrix', 'itf'];
          barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            
            // Start native scanning loop
            animationFrameRef.current = requestAnimationFrame(scanWithNativeDetector);
          }
        } else {
          console.log("Native BarcodeDetector not supported, using html5-qrcode");
          
          // Fallback to html5-qrcode
          const html5QrcodeScanner = new Html5Qrcode(scannerContainerId);
          scannerRef.current = html5QrcodeScanner;

          await html5QrcodeScanner.start(
            { facingMode: "environment" },
            {
              fps: 30,
              qrbox: { width: 350, height: 200 },
              aspectRatio: 1.777778,
              disableFlip: false,
            },
            (decodedText) => {
              handleBarcodeDetected(decodedText);
            },
            (errorMessage) => {
              if (!errorMessage.includes("NotFoundException")) {
                console.log("Scan error:", errorMessage);
              }
            }
          );
        }
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

    const timer = setTimeout(() => {
      startScanning();
    }, 100);

    // Cleanup
    return () => {
      clearTimeout(timer);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch((err) => {
          console.log("Error stopping scanner:", err);
        });
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [isActive, onScan, handleBarcodeDetected, scanWithNativeDetector]);

  if (!isActive) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardContent className="p-3">
        <div className="relative">
          {/* Scanner Container */}
          <div className="relative bg-black rounded-lg overflow-hidden">
            {/* Native BarcodeDetector uses video element */}
            <video
              ref={videoRef}
              className="w-full h-auto"
              autoPlay
              playsInline
              muted
              onClick={handleTapToFocus}
              onTouchStart={handleTapToFocus}
              style={{ display: barcodeDetectorRef.current ? 'block' : 'none' }}
            />
            
            {/* html5-qrcode container (hidden when using native) */}
            <div 
              id={scannerContainerId} 
              className="w-full"
              style={{ display: barcodeDetectorRef.current ? 'none' : 'block' }}
            />
            
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
                    Tap to focus • Point barcode here
                  </div>
                </div>
              </div>
            )}

            {/* Torch button */}
            {isScanning && !error && streamRef.current && (
              <button
                onClick={toggleTorch}
                className={`absolute top-4 right-4 p-2 rounded-full pointer-events-auto ${
                  torchEnabled ? 'bg-amber-500 text-black' : 'bg-black/60 text-white'
                }`}
              >
                <Zap className="h-5 w-5" />
              </button>
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