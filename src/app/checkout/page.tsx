"use client";

// =============================================
// Checkout
//
// A keypad screen, not a form. The cashier is holding cash in one hand and the
// phone in the other, so there is no OS keyboard: digits come from an on-screen
// pad, and the currency the pad is typing into is chosen by the LL / USD
// segmented control at the top.
//
// Split payments are preserved from the old two-input form — the LL and USD
// amounts are two independent values that both stay entered; the segmented
// control only decides which one the pad is currently editing.
// =============================================

import { useCallback, useEffect, useState, useTransition, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Check,
  Copy,
  Delete,
  Loader2,
  Printer,
  Share2,
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { toast } from "@/lib/toast";
import {
  formatLL,
  formatLLParts,
  formatUSD,
  SELL_RATE,
  RETURN_RATE,
  convertUsdToLlForReturn,
} from "@/lib/utils/format";
import { generateReceiptToken } from "@/lib/receipt/token";
import { vibrate } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";

type PayCurrency = "LL" | "USD";

/** Longest entry the pad will accept, in characters. */
const MAX_ENTRY_LENGTH = 12;

function appendLL(prev: string, key: string): string {
  const next = (prev + key).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return next.slice(0, MAX_ENTRY_LENGTH);
}

function appendUSD(prev: string, key: string): string {
  if (key === ".") {
    if (prev.includes(".")) return prev;
    return prev === "" ? "0." : prev + ".";
  }
  const next = (prev + key).replace(/^0+(?=\d)/, "");
  if (!/^\d*\.?\d{0,2}$/.test(next)) return prev;
  return next.slice(0, MAX_ENTRY_LENGTH);
}

function CheckoutContent() {
  const router = useRouter();

  const [currency, setCurrency] = useState<PayCurrency>("LL");
  const [amountPaidLL, setAmountPaidLL] = useState<string>("");
  const [amountPaidUSD, setAmountPaidUSD] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [transactionNumber, setTransactionNumber] = useState<string>("");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [changeGiven, setChangeGiven] = useState<number>(0);
  const [changeUsd, setChangeUsd] = useState<number>(0);
  const [showSummary, setShowSummary] = useState(false);
  const [receiptToken, setReceiptToken] = useState<string>("");
  const [receiptUrl, setReceiptUrl] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  // Navigating away from a finished sale is not instant — /pos remounts the
  // catalogue and the scanner. Without a pending state the button looks dead
  // and invites a second tap.
  const [isLeaving, startLeaving] = useTransition();

  const {
    items,
    getSubtotal,
    getSubtotalUsd,
    getTotal,
    getTotalUsd,
    getTotalDiscount,
    getTotalOriginal,
    getRoundingAdjustment,
    clearCart,
  } = useCartStore();

  const total = getTotal();
  const totalUsd = getTotalUsd();
  const roundingAdjustment = getRoundingAdjustment();

  // Calculate total paid - combine both currencies
  // USD is valued at RETURN_RATE (89,000) so the store wins on incoming USD.
  // The LL-equivalent of USD payments is rounded to the nearest 5,000 so that
  // every totalPaid value is a clean multiple of 5,000 LL.
  const paidLL = parseFloat(amountPaidLL) || 0;
  const paidUSD = parseFloat(amountPaidUSD) || 0;
  const usdAsLl = convertUsdToLlForReturn(paidUSD);
  const totalPaid = paidLL + usdAsLl;

  // Balance calculation
  const difference = totalPaid - total;
  const isChangeDue = difference > 0;
  const displayChangeLL = Math.abs(difference);

  // Determine the rate to use for showing USD equivalent of change
  // - Paid only USD → RETURN_RATE (89,000) — customer already dealing in USD
  // - Paid only LL  → SELL_RATE (90,000) — store sells USD back at higher rate
  // - Paid both     → blended rate weighted by each currency's contribution
  function getChangeRate(): number {
    if (paidUSD > 0 && paidLL === 0) return RETURN_RATE;
    if (paidLL > 0 && paidUSD === 0) return SELL_RATE;
    // Nothing entered yet — no change to value. Returning a rate rather than
    // dividing by a zero total keeps the derived USD figure a number.
    if (totalPaid <= 0) return SELL_RATE;
    // Both: weighted average of rates by contribution to total
    const llWeight = paidLL / totalPaid;
    const usdWeight = (paidUSD * RETURN_RATE) / totalPaid;
    return llWeight * SELL_RATE + usdWeight * RETURN_RATE;
  }

  function getChangeRateLabel(): string {
    if (paidUSD > 0 && paidLL === 0) return `$1 = ${formatLL(RETURN_RATE)}`;
    if (paidLL > 0 && paidUSD === 0) return `$1 = ${formatLL(SELL_RATE)}`;
    return `blended $1 ≈ ${formatLL(Math.round(getChangeRate()))}`;
  }

  const changeRate = getChangeRate();
  const displayChangeUSD = displayChangeLL / changeRate;

  // ---- Keypad ----

  const pressKey = useCallback(
    (key: string) => {
      vibrate(8);
      if (currency === "LL") setAmountPaidLL((prev) => appendLL(prev, key));
      else setAmountPaidUSD((prev) => appendUSD(prev, key));
    },
    [currency]
  );

  const pressBackspace = useCallback(() => {
    vibrate(8);
    if (currency === "LL") setAmountPaidLL((prev) => prev.slice(0, -1));
    else setAmountPaidUSD((prev) => prev.slice(0, -1));
  }, [currency]);

  const handleClear = useCallback(() => {
    vibrate(12);
    setAmountPaidLL("");
    setAmountPaidUSD("");
  }, []);

  // A checkout with an empty cart has nothing to pay for. Reaching one means
  // the user got here by a route that should not exist — a back gesture onto a
  // finished sale, a stale prefetch, a refresh after the cart was cleared — so
  // hand them back to the POS instead of showing a 0 LL keypad.
  //
  // The delayed re-read guards against a first paint before the persisted cart
  // has rehydrated; it checks the live store, not the render-time snapshot.
  useEffect(() => {
    if (transactionComplete || items.length > 0) return;
    const timer = setTimeout(() => {
      if (useCartStore.getState().items.length === 0) {
        router.replace("/pos");
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [items.length, transactionComplete, router]);

  // ---- Hardware keyboard (desktop tills) ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (transactionComplete) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressKey(e.key);
      } else if (e.key === "." && currency === "USD") {
        e.preventDefault();
        pressKey(".");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pressBackspace();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currency, pressKey, pressBackspace, handleClear, transactionComplete]);

  // Generate transaction number
  const generateTransactionNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
  };

  // Handle payment processing
  const handleProcessPayment = async () => {
    if (items.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    if (totalPaid <= 0) {
      toast.error("Please enter payment amount");
      return;
    }

    if (totalPaid < total) {
      toast.error("Insufficient payment amount");
      return;
    }

    setIsProcessing(true);

    try {
      const txnNumber = generateTransactionNumber();
      setTransactionNumber(txnNumber);

      // Generate unguessable receipt token (works fully offline)
      const token = generateReceiptToken();
      setReceiptToken(token);
      setReceiptUrl(`${window.location.origin}/receipt/${token}`);

      const calculatedChangeGiven = totalPaid - total;
      const calcChangeUsd = calculatedChangeGiven / changeRate;

      setPaidAmount(totalPaid);
      setChangeGiven(calculatedChangeGiven);
      setChangeUsd(calcChangeUsd);

      // Get current user info
      const currentUser = JSON.parse(localStorage.getItem("goldensquirrel_user") || "{}");

      // Build user info - always include user_name for tracking who processed the transaction
      // user_id is only for employees (references store_users table)
      const userInfo: any = {};
      if (currentUser && currentUser.username) {
        userInfo.user_name = currentUser.displayName || currentUser.username;
        // Only set user_id for employees (not owners, whose ID is a store_id)
        if (!currentUser.isOwner && currentUser.id) {
          userInfo.user_id = currentUser.id;
        }
      }

      // Save transaction to database
      const transactionData: any = {
        transaction_number: txnNumber,
        receipt_token: token,
        subtotal: getSubtotal(),
        total_amount: total,
        amount_paid: totalPaid,
        change_given: calculatedChangeGiven,
        payment_method: "cash",
        usd_subtotal: getSubtotalUsd(),
        usd_total_amount: totalUsd,
        usd_amount_paid: paidUSD,
        usd_change_given: calcChangeUsd,
        items: items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          currency: item.currency,
          unit_price_usd: item.unit_price_usd,
          total_price_usd: item.total_price_usd,
        })),
        ...userInfo,
      };

      // Build the offline queue payload up-front so we can fall back to it
      // if the online save fails (e.g. navigator.onLine lies on desktop).
      const { queueTransaction } = await import("@/lib/db/localDB");
      const authDataOffline = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      // Ensure store_id is never empty - try multiple fallbacks
      const offlineStoreId = authDataOffline.store_id || "";
      const offlineTxnData: any = {
        id: crypto.randomUUID(),
        store_id: offlineStoreId,
        transaction_number: txnNumber,
        receipt_token: token,
        subtotal: getSubtotal(),
        total_amount: total,
        amount_paid: totalPaid,
        change_given: calculatedChangeGiven,
        payment_method: "cash",
        subtotal_usd: getSubtotalUsd(),
        total_usd: totalUsd,
        amount_paid_usd: paidUSD,
        change_given_usd: calcChangeUsd,
        items: items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          currency: item.currency,
          unit_price_usd: item.unit_price_usd,
          total_price_usd: item.total_price_usd,
        })),
        created_at: new Date().toISOString(),
      };
      // Add user_name for ALL users (owners included) - always set independently of user_id
      if (currentUser && currentUser.username) {
        offlineTxnData.user_name = currentUser.displayName || currentUser.username;
        // Only set user_id for employees (not owners, whose ID is a store_id)
        if (!currentUser.isOwner && currentUser.id) {
          offlineTxnData.user_id = currentUser.id;
        }
      } else {
        // Fallback: try to get user info from auth data
        try {
          const storedUser = JSON.parse(localStorage.getItem("goldensquirrel_user") || "{}");
          if (storedUser.displayName) {
            offlineTxnData.user_name = storedUser.displayName;
          } else if (storedUser.username) {
            offlineTxnData.user_name = storedUser.username;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      // NOTE: Stock decrements are now handled server-side in the /api/transactions
      // POST route. No client-side stock decrement queuing is needed.
      // This prevents double-decrementing for offline transactions.

      let savedOnline = false;
      if (navigator.onLine) {
        // Online: Save directly to Supabase
        try {
          const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");

          const response = await fetch("/api/transactions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-auth-data": JSON.stringify({ store_id: authData.store_id }),
            },
            body: JSON.stringify(transactionData),
          });

          if (!response.ok) {
            throw new Error("Failed to save transaction");
          }
          savedOnline = true;
        } catch (error) {
          // Fall back to offline queue so the transaction is NEVER lost.
          console.error("Failed to save transaction online, queuing offline:", error);
        }
      }

      if (!savedOnline) {
        await queueTransaction(offlineTxnData);
        toast.info("Transaction saved offline - will sync when online");
      }

      // Reflect stock decrement in local cache IMMEDIATELY.
      // The server already decremented stock (or will when synced), but the
      // local cache has a 5-minute freshness window that would otherwise
      // show stale stock levels until the next sync.
      try {
        const { decrementCachedStock } = await import("@/lib/db/localDB");
        await decrementCachedStock(
          items.map((item) => ({ product_id: item.product_id, quantity: item.quantity }))
        );
      } catch (e) {
        console.warn("[Checkout] Failed to update cached stock:", e);
      }

      // Transaction complete — just show receipt
      setTransactionComplete(true);
      toast.success("Payment processed successfully!");

      // Generate QR code for the digital receipt (client-side, works offline)
      try {
        const url = `${window.location.origin}/receipt/${token}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        setQrDataUrl(dataUrl);
      } catch (qrError) {
        console.error("Failed to generate QR code:", qrError);
      }
    } catch (error) {
      console.error("Error processing payment:", error);
      toast.error("Failed to process payment");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle new transaction
  const handleNewTransaction = () => {
    clearCart();
    // replace(), not push(). Going to /pos with push() leaves the finished
    // checkout sitting on the history stack directly behind it, so the next
    // back gesture drops the cashier onto a completed receipt — which reads
    // exactly like "New sale took me back to checkout".
    startLeaving(() => router.replace("/pos"));
  };

  // Copy receipt link to clipboard
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      toast.success("Receipt link copied to clipboard");
    } catch (err) {
      console.error("Failed to copy link:", err);
      toast.error("Failed to copy link");
    }
  };

  // Share receipt link via Web Share API
  const handleShareReceipt = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Receipt - ${transactionNumber}`,
          text: `Your receipt for transaction ${transactionNumber}`,
          url: receiptUrl,
        });
      } catch (err) {
        // User cancelled share
      }
    } else {
      await handleCopyLink();
    }
  };

  // Print the QR code (for hard-copy at the register)
  const handlePrintQR = () => {
    const printWindow = window.open("", "_blank", "width=400,height=500");
    if (!printWindow) {
      toast.error("Please allow pop-ups to print the QR code");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt QR - ${transactionNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
            h2 { margin-bottom: 4px; }
            p { color: #666; margin-bottom: 16px; }
            img { max-width: 300px; }
            .url { font-size: 12px; color: #888; word-break: break-all; margin-top: 12px; }
          </style>
        </head>
        <body>
          <h2>Scan for Digital Receipt</h2>
          <p>Transaction #${transactionNumber}</p>
          <img src="${qrDataUrl}" alt="Receipt QR Code" />
          <div class="url">${receiptUrl}</div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // ===================== COMPLETE =====================
  if (transactionComplete) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="safe-top flex-shrink-0" />
        {/* Only this middle band scrolls, and only on a short phone — the
            "New sale" button below it never moves. */}
        <div className="no-scrollbar mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-5 pb-2 pt-6">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <Check className="h-8 w-8 text-emerald-400" />
          </div>

          <h1 className="text-center text-2xl font-bold">Payment complete</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground tnum">
            #{transactionNumber}
          </p>

          <div className="mt-6 space-y-2 rounded-3xl bg-card px-5 py-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold tnum">{formatLL(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-bold tnum">{formatLL(paidAmount)}</span>
            </div>
            {paidUSD > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground tnum">
                <span>of which USD</span>
                <span>
                  {formatUSD(paidUSD)} @ {formatLL(RETURN_RATE)}/USD
                </span>
              </div>
            )}
            {changeGiven > 0 && (
              <div className="flex items-baseline justify-between border-t border-white/[0.07] pt-2 text-emerald-400">
                <span className="font-semibold">Change</span>
                <span className="text-right">
                  <span className="text-lg font-bold tnum">{formatLL(changeGiven)}</span>
                  <span className="ml-2 text-xs tnum">{formatUSD(changeUsd)}</span>
                </span>
              </div>
            )}
          </div>

          {qrDataUrl && (
            <div className="mt-4 rounded-3xl border p-4 text-center">
              <p className="mb-3 text-xs text-muted-foreground">
                Customer scans this for their receipt
              </p>
              <div className="mb-3 flex justify-center">
                <img
                  src={qrDataUrl}
                  alt="Digital receipt QR code"
                  className="h-36 w-36 rounded-xl bg-white p-2"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="rounded-xl" onClick={handleCopyLink}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={handleShareReceipt}>
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={handlePrintQR}>
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
              </div>
            </div>
          )}

        </div>

        <div className="mx-auto w-full max-w-md flex-shrink-0 px-5 pb-3 pt-2">
          <button
            type="button"
            onClick={handleNewTransaction}
            disabled={isLeaving}
            className="tap flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground disabled:opacity-70"
          >
            {isLeaving && <Loader2 className="h-5 w-5 animate-spin" />}
            New sale
          </button>
        </div>
      </div>
    );
  }

  // ===================== PAYMENT =====================
  const keypadKeys: string[] =
    currency === "LL"
      ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"];

  const entry = currency === "LL" ? amountPaidLL : amountPaidUSD;
  const hasEntry = entry.length > 0;
  const activeDisplay =
    currency === "LL" ? formatLLParts(paidLL).value : `$${amountPaidUSD || "0"}`;
  const activeUnit = currency === "LL" ? "LL" : "";

  const otherLabel =
    currency === "LL"
      ? paidUSD > 0
        ? `${formatUSD(paidUSD)} in USD`
        : null
      : paidLL > 0
        ? `${formatLL(paidLL)} in LL`
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ---- Header ---- */}
      <header className="safe-top flex-shrink-0 px-4 pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            // replace() for the same reason as "New sale": pushing /pos when
            // /pos is already behind us builds [pos, checkout, pos], and one
            // back gesture lands on checkout again. /checkout never
            // accumulates on the stack.
            onClick={() => router.replace("/pos")}
            aria-label="Back to sale"
            className="tap flex h-10 w-10 items-center justify-center rounded-full bg-muted/70"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex-1 text-lg font-bold">Checkout</h1>
          <button
            type="button"
            onClick={() => setShowSummary(true)}
            className="tap rounded-full px-3 py-1.5 text-sm text-muted-foreground"
          >
            {items.length} item{items.length !== 1 ? "s" : ""}
          </button>
        </div>
      </header>

      {/* ---- Amount due ---- */}
      <div className="flex-shrink-0 px-5 pt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Amount due
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-[40px] font-extrabold leading-none tnum">
            {formatLLParts(total).value}
            <span className="ml-1.5 text-lg font-bold text-muted-foreground">
              {formatLLParts(total).unit}
            </span>
          </p>
          <p className="text-sm text-muted-foreground tnum">{formatUSD(totalUsd)}</p>
        </div>
        {roundingAdjustment !== 0 && (
          <p className="mt-1 text-xs text-muted-foreground tnum">
            Rounded {roundingAdjustment > 0 ? "+" : "−"}
            {Math.abs(Math.round(roundingAdjustment)).toLocaleString("en-US")} to the nearest
            5,000
          </p>
        )}
      </div>

      {/* ---- Currency ---- */}
      <div className="flex-shrink-0 px-5 pt-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1">
          {(["LL", "USD"] as PayCurrency[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                vibrate(10);
                setCurrency(c);
              }}
              aria-pressed={currency === c}
              className={cn(
                "tap h-10 rounded-xl text-sm font-bold transition-colors",
                currency === c
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Received + change ---- */}
      <div className="flex-shrink-0 px-5 pt-3">
        <div className="rounded-2xl border border-primary/40 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              Received
              {otherLabel && <span className="tnum"> · + {otherLabel}</span>}
            </span>
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasEntry && totalPaid <= 0}
              className="tap -mr-1 flex-none rounded-lg px-1.5 py-0.5 text-sm font-bold text-destructive disabled:pointer-events-none disabled:opacity-30"
            >
              Clear
            </button>
          </div>

          <p className="mt-0.5 flex items-baseline text-[30px] font-extrabold leading-tight text-primary tnum">
            {activeDisplay}
            {activeUnit && <span className="ml-1.5 text-base font-bold">{activeUnit}</span>}
            <span className="ml-1 h-7 w-px animate-pulse bg-primary" aria-hidden />
          </p>

          {otherLabel && (
            <p className="mt-0.5 text-xs text-muted-foreground tnum">
              Total paid {formatLL(totalPaid)}
            </p>
          )}

          <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.07] pt-2.5">
            {totalPaid <= 0 ? (
              <>
                <span className="text-sm font-semibold text-muted-foreground">Change due</span>
                <span className="text-lg font-bold text-muted-foreground tnum">—</span>
              </>
            ) : isChangeDue ? (
              <>
                <span className="text-sm font-semibold text-emerald-400">Change due</span>
                <span className="text-right">
                  <span
                    key={displayChangeLL}
                    className="animate-value-bump text-[22px] font-extrabold text-emerald-400 tnum"
                  >
                    {formatLL(displayChangeLL)}
                  </span>
                  <span className="ml-2 text-xs text-emerald-400/80 tnum">
                    {formatUSD(displayChangeUSD)} · {getChangeRateLabel()}
                  </span>
                </span>
              </>
            ) : displayChangeLL > 0 ? (
              <>
                <span className="text-sm font-semibold text-primary">Still due</span>
                <span
                  key={displayChangeLL}
                  className="animate-value-bump text-[22px] font-extrabold text-primary tnum"
                >
                  {formatLL(displayChangeLL)}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-emerald-400">Exact payment</span>
                <Check className="h-5 w-5 text-emerald-400" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---- Keypad ---- */}
      <div className="grid min-h-0 flex-1 grid-cols-3 auto-rows-fr gap-2 px-5 py-3">
        {keypadKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pressKey(key)}
            className="tap flex items-center justify-center rounded-2xl bg-muted/50 text-2xl font-semibold tnum active:bg-muted"
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          onClick={pressBackspace}
          aria-label="Delete last digit"
          className="tap flex items-center justify-center rounded-2xl bg-muted/50 active:bg-muted"
        >
          <Delete className="h-6 w-6" />
        </button>
      </div>

      {/* ---- Confirm ----
           No safe-bottom here: the tab bar below now owns the home-indicator
           inset, and doubling it just wastes a keypad row. */}
      <div className="flex-shrink-0 px-5 pb-3">
        <button
          type="button"
          onClick={handleProcessPayment}
          disabled={isProcessing || totalPaid < total}
          className="tap flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Check className="h-5 w-5" />
              <span className="tnum">Process Payment · {formatLL(total)}</span>
            </>
          )}
        </button>
      </div>

      {/* ---- Order summary ---- */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Order summary</DialogTitle>
            <DialogDescription>
              {items.length} item{items.length !== 1 ? "s" : ""} in this sale
            </DialogDescription>
          </DialogHeader>

          <div className="no-scrollbar max-h-[46vh] space-y-3 overflow-y-auto">
            {items.map((item) => (
              <div key={item.product_id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.product_name}</span>
                  <span className="text-muted-foreground tnum"> × {item.quantity}</span>
                </span>
                <span className="flex-shrink-0 text-right">
                  <span className="block font-semibold tnum">{formatLL(item.total_price)}</span>
                  <span className="block text-xs text-muted-foreground tnum">
                    {formatUSD(item.total_price_usd)}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t pt-4 text-sm">
            {getTotalDiscount() > 0 && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tnum">{formatLL(getTotalOriginal())}</span>
                </div>
                <div className="flex justify-between text-emerald-400">
                  <span>Discount</span>
                  <span className="tnum">−{formatLL(getTotalDiscount())}</span>
                </div>
              </>
            )}
            {roundingAdjustment !== 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Rounding adjustment</span>
                <span className="tnum">
                  {roundingAdjustment > 0 ? "+" : ""}
                  {formatLL(Math.round(roundingAdjustment))}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-1 text-lg font-bold">
              <span>Total</span>
              <span className="text-right">
                <span className="block text-primary tnum">{formatLL(total)}</span>
                <span className="block text-sm font-normal text-muted-foreground tnum">
                  {formatUSD(totalUsd)}
                </span>
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="h-full bg-background" />}>
      <CheckoutContent />
    </Suspense>
  );
}
