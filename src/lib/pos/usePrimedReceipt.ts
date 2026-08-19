"use client";

/**
 * Pre-generates the next sale's receipt token and its QR code image.
 *
 * The QR encodes nothing but `/receipt/<token>`, and the token is 192 bits of
 * local randomness — neither depends on the cart, the payment, or the server.
 * So there is no reason to make the customer wait for `QRCode.toDataURL()`
 * (tens of ms of canvas work) at the moment the sale ends. Prime it on mount
 * and hand it over synchronously when the sale completes.
 *
 * The transaction NUMBER is deliberately NOT primed here: it embeds
 * `Date.now()`, so pre-generating it would stamp sales with their page-mount
 * time. It is a synchronous string build at completion time anyway.
 *
 * A primed token that is never used is simply discarded — it was never sent
 * anywhere, so burning one costs nothing.
 */

import { useCallback, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { generateReceiptToken } from "@/lib/receipt/token";

export interface PrimedReceipt {
  token: string;
  receiptUrl: string;
  /** Empty only if taken before priming finished; then use `whenQrReady`. */
  qrDataUrl: string;
  whenQrReady: Promise<string>;
}

interface Primed {
  token: string;
  receiptUrl: string;
  qrDataUrl: string;
  whenQrReady: Promise<string>;
}

function prime(): Primed {
  const token = generateReceiptToken();
  const receiptUrl = `${window.location.origin}/receipt/${token}`;
  const entry: Primed = {
    token,
    receiptUrl,
    qrDataUrl: "",
    whenQrReady: Promise.resolve(""),
  };
  entry.whenQrReady = QRCode.toDataURL(receiptUrl, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: "M",
  })
    .then((dataUrl) => {
      entry.qrDataUrl = dataUrl;
      return dataUrl;
    })
    .catch((err) => {
      console.error("Failed to pre-generate QR code:", err);
      return "";
    });
  return entry;
}

export function usePrimedReceipt() {
  const primedRef = useRef<Primed | null>(null);

  useEffect(() => {
    if (!primedRef.current) {
      primedRef.current = prime();
    }
  }, []);

  /**
   * Claim the primed receipt and immediately start priming the next one, so a
   * cashier ringing sales back to back never pays the generation cost either.
   */
  const takeReceipt = useCallback((): PrimedReceipt => {
    const current = primedRef.current ?? prime();
    primedRef.current = prime();
    return current;
  }, []);

  return { takeReceipt };
}
