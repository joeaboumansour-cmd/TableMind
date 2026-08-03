"use client";

import { useRef, useEffect } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeLabelProps {
  /** 13-digit EAN-13 barcode */
  barcode: string;
  /** Category display name */
  categoryName?: string;
  /** Color display name */
  colorName?: string;
  /** Size display name */
  sizeName?: string;
  /** Optional product name for the label */
  productName?: string;
  /** Use smaller dimensions for compact layouts */
  compact?: boolean;
}

/**
 * Reusable barcode label component.
 * Renders an EAN-13 barcode as crisp SVG (vector-based, prints at max quality)
 * along with optional product info text below.
 */
export default function BarcodeLabel({
  barcode,
  categoryName,
  colorName,
  sizeName,
  productName,
  compact = false,
}: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && barcode) {
      try {
        JsBarcode(svgRef.current, barcode, {
          format: "CODE128",
          width: compact ? 1.2 : 1.5,
          height: compact ? 32 : 40,
          displayValue: true,
          fontSize: compact ? 9 : 11,
          fontOptions: "bold",
          margin: 10,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch (e) {
        console.error("Barcode render error:", e);
      }
    }
  }, [barcode, compact]);

  const hasText = productName || categoryName || colorName || sizeName;

  return (
    <div className="flex flex-col items-center justify-start bg-white border border-gray-300 rounded p-3 label-item">
      <svg ref={svgRef} />
      {hasText && (
        <div className="text-center mt-0.5 text-[10px] leading-tight text-gray-800 w-full overflow-hidden">
          {productName && (
            <p className="font-semibold truncate">{productName}</p>
          )}
          {(categoryName || colorName || sizeName) && (
            <p className="truncate">
              {[categoryName, colorName, sizeName]
                .filter(Boolean)
                .join(" / ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}