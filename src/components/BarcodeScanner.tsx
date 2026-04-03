"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, X, Scan, ZoomIn, ZoomOut, Flashlight } from "lucide-react";

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
  const [currentZoom, setCurrentZoom] = useState<number>(1);
  const [maxZoom, setMaxZoom] = useState<number>(1);
  const [minZoom, setMinZoom] = useState<number>(1);
  const [zoomSupported, setZoomSupported] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const isProcessingRef = useRef<boolean>(false);

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

  // Apply zoom to camera
  const applyZoom = useCallback(async (zoomLevel: number) => {
    if (!videoTrackRef.current || !zoomSupported) return;
    
    try {
      const capabilities = videoTrackRef.current.getCapabilities() as any;
      if (capabilities.zoom) {
        const clampedZoom = Math.max(capabilities.zoom.min, Math.min(zoomLevel, capabilities.zoom.max));
        await videoTrackRef.current.applyConstraints({
          advanced: [{ zoom: clampedZoom } as any]
        });
        setCurrentZoom(clampedZoom);
      }
    } catch (err) {
      console.error("Error applying zoom:", err);
    }
  }, [zoomSupported]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    const newZoom = Math.min(currentZoom + 0.5, maxZoom);
    applyZoom(newZoom);
  }, [currentZoom, maxZoom, applyZoom]);

  const zoomOut = useCallback(() => {
    const newZoom = Math.max(currentZoom - 0.5, minZoom);
    applyZoom(newZoom);
  }, [currentZoom, minZoom, applyZoom]);

  // Toggle torch/flashlight
  const toggleTorch = useCallback(async () => {
    if (!videoTrackRef.current || !torchSupported) return;
    
    try {
      const newTorchState = !torchEnabled;
      await videoTrackRef.current.applyConstraints({
        advanced: [{ torch: newTorchState } as any]
      });
      setTorchEnabled(newTorchState);
    } catch (err) {
      console.error("Error toggling torch:", err);
    }
  }, [torchEnabled, torchSupported]);

  // Handle barcode detection with debouncing
  const handleBarcodeDetected = useCallback((barcode: string) => {
    // Prevent multiple rapid scans
    if (isProcessingRef.current) return;
    if (barcode === lastScannedCode) return;
    
    isProcessingRef.current = true;
    setLastScannedCode(barcode);
    playBeepSound();
    onScan(barcode);
    
    // Reset after 3 seconds to allow scanning same code again
    setTimeout(() => {
      setLastScannedCode(null);
      isProcessingRef.current = false;
    }, 3000);
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

        // Clear any existing scanner
        if (scannerRef.current) {
          try {
            await scannerRef.current.stop();
          } catch (e) {
            // Ignore
          }
        }

        // Create scanner instance
        const scanner = new Html5Qrcode("barcode-scanner");
        scannerRef.current = scanner;

        const config = {
          fps: 5, // Reduced FPS to prevent rapid scanning
          qrbox: { width: 250, height: 150 },
          aspectRatio: 1.0,
          disableFlip: false,
          rememberLastUsedCamera: true,
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
          () => {
            // Ignore scanning errors - they happen frequently
          }
        );

        if (isMounted) {
          setIsScanning(true);
          
          // Get video track for zoom control
          setTimeout(() => {
            try {
              const videoElement = document.querySelector("#barcode-scanner video") as HTMLVideoElement;
              if (videoElement && videoElement.srcObject) {
                const stream = videoElement.srcObject as MediaStream;
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) {
                  videoTrackRef.current = videoTrack;
                  const capabilities = videoTrack.getCapabilities() as any;
                  
                  if (capabilities.zoom) {
                    setZoomSupported(true);
                    setMinZoom(capabilities.zoom.min);
                    setMaxZoom(capabilities.zoom.max);
                    // Set default zoom to 3x or max available
                    const defaultZoom = Math.min(3, capabilities.zoom.max);
                    setCurrentZoom(defaultZoom);
                    // Apply the zoom
                    videoTrack.applyConstraints({
                      advanced: [{ zoom: defaultZoom } as any]
                    }).catch(() => {});
                  } else {
                    setZoomSupported(false);
                  }
                  
                  // Check torch support
                  if (capabilities.torch) {
                    setTorchSupported(true);
                  } else {
                    setTorchSupported(false);
                  }
                }
              }
            } catch (zoomErr) {
              setZoomSupported(false);
            }
          }, 500);
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error("Error starting barcode scanner:", err);
        
        if (err.message?.includes("Permission denied") || err.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access and refresh.");
        } else if (err.message?.includes("No camera") || err.name === "NotFoundError") {
          setError("No camera found. Please connect a camera and refresh.");
        } else if (err.message?.includes("in use") || err.name === "NotReadableError") {
          setError("Camera is in use by another application.");
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
      isProcessingRef.current = false;
      
      if (scannerRef.current) {
        try {
          scannerRef.current.stop().catch(() => {});
        } catch (err) {
          // Ignore
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
          {/* Scanner Container - Fixed Height */}
          <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: "240px" }}>
            {/* Scanner element */}
            <div 
              id="barcode-scanner" 
              className="w-full h-full"
              style={{ 
                overflow: "hidden"
              }}
            />
            
            {/* Scanning Overlay */}
            {isScanning && !error && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner markers */}
                <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-amber-500 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-amber-500 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-amber-500 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-amber-500 rounded-br-lg" />
                
                {/* Zoom and Flashlight controls */}
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 pointer-events-auto flex items-center gap-2">
                  {zoomSupported && (
                    <div className="flex items-center gap-2 bg-black/70 rounded-full px-3 py-1.5">
                      <button
                        onClick={zoomOut}
                        disabled={currentZoom <= minZoom}
                        className="p-1 rounded-full text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ZoomOut className="h-4 w-4" />
                      </button>
                      <span className="text-white text-xs font-medium min-w-[2.5rem] text-center">
                        {currentZoom.toFixed(1)}x
                      </span>
                      <button
                        onClick={zoomIn}
                        disabled={currentZoom >= maxZoom}
                        className="p-1 rounded-full text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ZoomIn className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {torchSupported && (
                    <button
                      onClick={toggleTorch}
                      className={`p-2 rounded-full transition-colors ${
                        torchEnabled 
                          ? 'bg-amber-500 text-black' 
                          : 'bg-black/70 text-white hover:bg-white/20'
                      }`}
                    >
                      <Flashlight className="h-4 w-4" />
                    </button>
                  )}
                </div>
                
                {/* Status text */}
                <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-auto">
                  <div className="bg-black/70 px-4 py-2 rounded-full text-white text-sm flex items-center gap-2">
                    <Scan className="h-4 w-4" />
                    Point barcode here
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                <div className="text-center text-white p-4">
                  <Camera className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm mb-3">{error}</p>
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
              <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                <div className="text-center text-white">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-3" />
                  <p className="text-sm">Starting camera...</p>
                </div>
              </div>
            )}
          </div>

          {/* Manual barcode entry */}
          <div className="mt-3 flex gap-2">
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
              className="h-9 text-sm"
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
              className="absolute top-2 right-2 z-10 h-8 w-8 p-0"
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