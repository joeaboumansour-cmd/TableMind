"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState<string>("");
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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
      
      oscillator.frequency.value = 1000; // 1000 Hz beep
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

        // Request camera permission with optimal settings for barcode scanning
        let videoStream: MediaStream | null = null;
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'environment', // Prefer back camera on mobile
              width: { ideal: 1920 }, // Higher resolution for distance detection
              height: { ideal: 1080 },
              frameRate: { ideal: 30, min: 15 } // Higher frame rate for faster detection
            } 
          });
          
          // Set the video stream to the video element so we can see the feed
          if (videoRef.current && videoStream) {
            videoRef.current.srcObject = videoStream;
          }
        } catch (permissionError: any) {
          console.error("Camera permission error:", permissionError);
          if (permissionError.name === 'NotAllowedError') {
            setError("Camera permission denied. Please allow camera access in your browser settings and refresh the page.");
          } else if (permissionError.name === 'NotFoundError') {
            setError("No camera found. Please connect a camera and refresh the page.");
          } else if (permissionError.name === 'NotReadableError') {
            setError("Camera is in use by another application. Please close other apps using the camera and try again.");
          } else {
            setError("Unable to access camera. Please check your browser permissions.");
          }
          setIsScanning(false);
          return;
        }

        // Create reader instance with optimized hints for fast detection
        const hints = new Map<DecodeHintType, any>();
        
        // Specify common barcode formats for faster scanning
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.ITF,
        ]);
        
        // Try harder mode - more thorough scanning for distant/partial barcodes
        hints.set(DecodeHintType.TRY_HARDER, true);
        
        readerRef.current = new BrowserMultiFormatReader(hints);

        // Get video devices
        const videoInputDevices = await readerRef.current.listVideoInputDevices();
        
        if (videoInputDevices.length === 0) {
          setError("No camera found. Please connect a camera.");
          setIsScanning(false);
          return;
        }

        // Find the back camera (environment facing)
        let selectedDeviceId = videoInputDevices[0].deviceId;
        
        // Look for a camera with "back" or "rear" in the label, or one that's not the front camera
        for (const device of videoInputDevices) {
          const label = device.label.toLowerCase();
          if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
            selectedDeviceId = device.deviceId;
            break;
          }
        }
        
        // If we still have the first device and there are multiple cameras, try to find one that's not front-facing
        if (selectedDeviceId === videoInputDevices[0].deviceId && videoInputDevices.length > 1) {
          for (const device of videoInputDevices) {
            const label = device.label.toLowerCase();
            if (!label.includes('front') && !label.includes('user') && !label.includes('selfie')) {
              selectedDeviceId = device.deviceId;
              break;
            }
          }
        }

        // Wait for video element to be ready with valid dimensions
        await new Promise<void>((resolve) => {
          const checkVideo = () => {
            if (videoRef.current && 
                videoRef.current.videoWidth > 0 && 
                videoRef.current.videoHeight > 0 &&
                videoRef.current.readyState >= 2) {
              resolve();
            } else {
              setTimeout(checkVideo, 100);
            }
          };
          checkVideo();
        });

        // Short delay to ensure video is fully loaded
        await new Promise(resolve => setTimeout(resolve, 200));

        // Start decoding from video element with error handling
        try {
          await readerRef.current.decodeFromVideoDevice(
            selectedDeviceId,
            videoRef.current!,
            (result, error) => {
              if (result) {
                const barcode = result.getText();
                const format = result.getBarcodeFormat();
                
                console.log("Barcode detected:", barcode, "Format:", format);
                
                // Avoid duplicate scans
                if (barcode !== lastScannedCode) {
                  setLastScannedCode(barcode);
                  playBeepSound();
                  onScan(barcode);
                  
                  // Reset last scanned code after 2 seconds
                  setTimeout(() => {
                    setLastScannedCode(null);
                  }, 2000);
                }
              }
              
              if (error) {
                if (error.name === "NotFoundException") {
                  // Normal - no barcode found in current frame
                } else if (error.message && error.message.includes("Index or size is negative")) {
                  // Known issue with canvas dimensions - stop scanning and show error
                  console.warn("Canvas dimension error - falling back to manual entry");
                  setError("Camera incompatible with barcode scanner. Please use manual entry below.");
                  setIsScanning(false);
                  if (readerRef.current) {
                    try {
                      readerRef.current.reset();
                    } catch (resetError) {
                      console.warn("Error resetting reader:", resetError);
                    }
                  }
                } else {
                  console.error("Barcode scan error:", error);
                }
              }
            }
          );
        } catch (scanError: any) {
          console.error("Error during scanning:", scanError);
          if (scanError.message && scanError.message.includes("Index or size is negative")) {
            setError("Camera error: Unable to process video. Please use manual entry below.");
            setIsScanning(false);
          }
        }
      } catch (err: any) {
        console.error("Error starting barcode scanner:", err);
        setError(err.message || "Failed to start camera");
        setIsScanning(false);
      }
    };

    startScanning();

    // Cleanup
    return () => {
      if (readerRef.current) {
        readerRef.current.reset();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Stop the video stream when component unmounts
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
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
          {/* Video Container */}
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
              muted
            />
            
            {/* Scanning Overlay */}
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Square scanning area */}
                <div className="relative w-64 h-40 border-2 border-amber-500 rounded-lg">
                  {/* Corner markers */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-amber-500 rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-amber-500 rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-amber-500 rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-amber-500 rounded-br-lg" />
                  
                  {/* Scanning line animation */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-0.5 bg-amber-500 animate-pulse" />
                  </div>
                  
                  {/* Center text */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/50 px-3 py-1 rounded text-white text-sm">
                      <Scan className="h-4 w-4 inline mr-2" />
                      Auto-detecting...
                    </div>
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
                  // Validate barcode length
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