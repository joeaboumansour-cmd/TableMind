"use client";

// =============================================
// Checkout
//
// A keypad screen, not a form. The cashier is holding cash in one hand and the
// phone in the other, so there is no OS keyboard: digits come from an on-screen
// pad.
//
// BOTH tenders are on screen at all times. Lebanon runs on split payments —
// "here is 200,000 and five dollars" is an ordinary transaction — and a
// currency TOGGLE hid half of that: whichever amount you were not editing was
// invisible, so the cashier had to remember it and could not check it against
// the notes in their hand. `activeField` is now only a cursor saying where the
// next digit lands; neither amount is ever hidden, and the balance is shown in
// LL and USD together.
// =============================================

import { useCallback, useEffect, useRef, useState, useTransition, Suspense } from "react";
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
import { buildTransactionItems, buildStockDecrements } from "@/lib/pos/lineItems";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import { toast } from "@/lib/toast";
import {
  formatLL,
  formatLLParts,
  formatUSD,
  SELL_RATE,
  RETURN_RATE,
  convertUsdToLlForReturn,
} from "@/lib/utils/format";
import { vibrate, playCompleteSound } from "@/lib/feedback";
import { usePrimedReceipt } from "@/lib/pos/usePrimedReceipt";
import {
  warmLocalDB,
  queueCompletedSale,
  pushSaleInBackground,
} from "@/lib/pos/saleCompletion";
import { StorageFullError } from "@/lib/db/localDB";
import { cn } from "@/lib/utils";
import { logActivity, flushActivity } from "@/lib/activity/logger";

/** Which amount the keypad is typing into. Both are always displayed. */
type PayField = "LL" | "USD";

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

  const [activeField, setActiveField] = useState<PayField>("LL");
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

  // Nothing about this screen is ever a safe moment to apply an update: the
  // cashier is either counting money into the keypad or reading back a receipt
  // the customer is waiting for. Hold unconditionally; the hold releases when
  // the screen unmounts.
  useReloadGuard(true, "checkout");
  // Navigating away from a finished sale is not instant — /pos remounts the
  // catalogue and the scanner. Without a pending state the button looks dead
  // and invites a second tap.
  const [isLeaving, startLeaving] = useTransition();

  // Token + QR image for the next sale are built on mount, so pressing
  // "Complete" costs zero QR work. See usePrimedReceipt.
  const { takeReceipt } = usePrimedReceipt();

  // Open the Dexie chunk/connection now rather than inside the sale handler,
  // where it would sit in front of the receipt.
  useEffect(() => {
    warmLocalDB();
  }, []);

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
      if (activeField === "LL") setAmountPaidLL((prev) => appendLL(prev, key));
      else setAmountPaidUSD((prev) => appendUSD(prev, key));
    },
    [activeField]
  );

  const pressBackspace = useCallback(() => {
    vibrate(8);
    if (activeField === "LL") setAmountPaidLL((prev) => prev.slice(0, -1));
    else setAmountPaidUSD((prev) => prev.slice(0, -1));
  }, [activeField]);

  const handleClear = useCallback(() => {
    vibrate(12);
    logActivity("sale.cleared", { details: { field: "amount_paid" } });
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
      } else if (e.key === "." && activeField === "USD") {
        e.preventDefault();
        pressKey(".");
      } else if (e.key === "Tab") {
        // Desktop tills have a keyboard but no touchscreen — Tab is how you
        // move between the two amounts without reaching for a mouse.
        e.preventDefault();
        setActiveField((f) => (f === "LL" ? "USD" : "LL"));
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
  }, [activeField, pressKey, pressBackspace, handleClear, transactionComplete]);

  // ---- F4: complete the sale ----
  //
  // The second half of the POS double-press. F4 there navigates here; F4 again
  // completes. Unlike the handler above this one fires even while a field has
  // focus, because on a till the LL amount box holds focus the whole time.
  //
  // Three cases, deliberately distinct:
  //   enough tendered -> normal completion, change and all
  //   nothing tendered -> express path, recorded as paying the total exactly,
  //                       identical to what the POS "Done" button records
  //   part tendered    -> refused. A half-typed amount is a mistake, and
  //                       rounding it up to the total would invent money that
  //                       never crossed the counter.
  //
  // e.repeat guards a leaned-on key completing a sale on its own.
  const processPaymentRef =
    useRef<(o?: { assumeExactPayment?: boolean }) => void>(() => {});
  useEffect(() => {
    processPaymentRef.current = handleProcessPayment;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.key !== "F4") return;
      e.preventDefault();
      if (transactionComplete || isProcessing || items.length === 0) return;

      if (totalPaid >= total) {
        processPaymentRef.current();
      } else if (totalPaid === 0) {
        processPaymentRef.current({ assumeExactPayment: true });
      } else {
        toast.error("Insufficient payment amount");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [transactionComplete, isProcessing, items.length, totalPaid, total]);

  // Generate transaction number
  const generateTransactionNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
  };

  // Handle payment processing
  /**
   * `assumeExactPayment` is the F4 express path: complete the sale with no
   * tender typed, recording the customer as having paid the total exactly and
   * taken no change. That is precisely what the POS "Done" button already
   * records (amount_paid: total, change_given: 0), so the two fast paths agree
   * with each other and with the books.
   *
   * It is NOT a way to record a shortfall. The caller only passes it when
   * nothing at all has been entered -- a half-typed amount is treated as a
   * mistake and refused, because silently rounding a partial tender up to the
   * total would invent money that never crossed the counter.
   */
  const handleProcessPayment = async (options?: { assumeExactPayment?: boolean }) => {
    const assumeExact = options?.assumeExactPayment === true;

    if (items.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    if (!assumeExact) {
      if (totalPaid <= 0) {
        toast.error("Please enter payment amount");
        return;
      }

      if (totalPaid < total) {
        toast.error("Insufficient payment amount");
        return;
      }
    }

    setIsProcessing(true);

    try {
      const txnNumber = generateTransactionNumber();

      // Claimed synchronously — token and QR image were generated on mount.
      const receipt = takeReceipt();

      // Express path pays the total exactly and returns nothing, matching the
      // POS "Done" flow. Otherwise these are the entered tenders as before.
      const effectiveTotalPaid = assumeExact ? total : totalPaid;
      const effectivePaidUsd = assumeExact ? 0 : paidUSD;
      const calculatedChangeGiven = assumeExact ? 0 : totalPaid - total;
      const calcChangeUsd = assumeExact ? 0 : calculatedChangeGiven / changeRate;

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
      } else {
        // Fallback: try to get user info from auth data
        const storedUser = currentUser || {};
        if (storedUser.displayName) {
          userInfo.user_name = storedUser.displayName;
        } else if (storedUser.username) {
          userInfo.user_name = storedUser.username;
        }
      }

      // One-off lines (an unknown barcode priced at the till) carry a
      // synthetic cart key, which is NOT a product_id. buildTransactionItems
      // maps those to null — the single place that rule lives, so the server
      // payload and the offline queue payload below cannot disagree about it.
      const lineItems = buildTransactionItems(items);

      // Payload for POST /api/transactions (server field names).
      const transactionData: any = {
        transaction_number: txnNumber,
        receipt_token: receipt.token,
        subtotal: getSubtotal(),
        total_amount: total,
        amount_paid: effectiveTotalPaid,
        change_given: calculatedChangeGiven,
        payment_method: "cash",
        usd_subtotal: getSubtotalUsd(),
        usd_total_amount: totalUsd,
        usd_amount_paid: effectivePaidUsd,
        usd_change_given: calcChangeUsd,
        items: lineItems,
        ...userInfo,
      };

      // Payload for the local offline queue (Dexie field names).
      const authDataOffline = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      const queuedId = crypto.randomUUID();
      const offlineTxnData: any = {
        id: queuedId,
        store_id: authDataOffline.store_id || "",
        transaction_number: txnNumber,
        receipt_token: receipt.token,
        subtotal: getSubtotal(),
        total_amount: total,
        amount_paid: effectiveTotalPaid,
        change_given: calculatedChangeGiven,
        payment_method: "cash",
        subtotal_usd: getSubtotalUsd(),
        total_usd: totalUsd,
        amount_paid_usd: effectivePaidUsd,
        change_given_usd: calcChangeUsd,
        items: lineItems,
        created_at: new Date().toISOString(),
        ...userInfo,
      };

      // Make the sale durable BEFORE showing a receipt for it. IndexedDB
      // write, single-digit ms. Everything slow happens after this point.
      const wasOffline = !navigator.onLine;
      await queueCompletedSale(offlineTxnData);

      // NOTE: Stock decrements are handled server-side in the /api/transactions
      // POST route; the local cache decrement rides along in the background
      // push below. No client-side stock queuing — that double-decrements.

      // --- Receipt is on screen from here. ---
      setTransactionNumber(txnNumber);
      setReceiptToken(receipt.token);
      setReceiptUrl(receipt.receiptUrl);
      setQrDataUrl(receipt.qrDataUrl);
      setPaidAmount(effectiveTotalPaid);
      setChangeGiven(calculatedChangeGiven);
      setChangeUsd(calcChangeUsd);
      // The sale-finished chime. It used to belong to the POS "Done" button,
      // which no longer exists — checkout is the only way a sale ends now, so
      // the sound follows it here. Cashiers work by ear at a busy counter and
      // ending a sale in silence reads as "did that go through?".
      playCompleteSound();
      setTransactionComplete(true);
      // The money event. Logged AFTER the sale is durable in offline_queue, so
      // it can never appear for a sale that was not actually saved — and, like
      // every other log call, never awaited.
      logActivity("sale.payment", {
        target: txnNumber,
        details: {
          total_ll: total,
          total_usd: totalUsd,
          amount_paid_ll: effectiveTotalPaid,
          change_given_ll: calculatedChangeGiven,
          change_given_usd: calcChangeUsd,
          payment_method: "cash",
          line_count: items.length,
          unit_count: items.reduce((sum, i) => sum + i.quantity, 0),
          assumed_exact: assumeExact,
          was_offline: wasOffline,
        },
      });
      toast.success("Payment processed successfully!");
      if (wasOffline) {
        toast.info("Transaction saved offline - will sync when online");
      }

      // Only reachable if the sale ended within ~30ms of the page mounting.
      if (!receipt.qrDataUrl) {
        void receipt.whenQrReady.then((dataUrl) => {
          if (dataUrl) setQrDataUrl(dataUrl);
        });
      }

      // Server write + local stock cache, off the critical path. On failure
      // the queued row above stays put and the sync engine retries it.
      pushSaleInBackground({
        queuedId,
        payload: transactionData,
        // One-off lines have no catalogue row, so no stock to move.
        stockDecrements: buildStockDecrements(items),
      });
    } catch (error) {
      console.error("Error processing payment:", error);
      // Distinguish "the disk is full" from a bug — it is the one failure here
      // the cashier can actually act on, and by this point every rebuildable
      // cache has already been sacrificed to try to make room.
      logActivity("error.handled", {
        target: "checkout payment failed",
        details: {
          storage_full: error instanceof StorageFullError,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      if (error instanceof StorageFullError) {
        toast.error("Device storage is full — this sale was NOT saved.", {
          description: "Free up space on the device and take the payment again before continuing.",
          duration: 15000,
        });
      } else {
        toast.error("Failed to process payment");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle new transaction
  const handleNewTransaction = () => {
    logActivity("sale.new");
    // Leaving the page — get whatever is buffered on its way before the route
    // change, rather than waiting out the 5s flush timer.
    flushActivity();
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
      logActivity("sale.receipt_share", {
        target: transactionNumber,
        details: { channel: "clipboard" },
      });
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
        logActivity("sale.receipt_share", {
          target: transactionNumber,
          details: { channel: "web_share" },
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
    logActivity("sale.receipt_print", { target: transactionNumber });
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
                  className="h-44 w-44 rounded-xl bg-white p-2"
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
  // "000" is only meaningful for LL (amounts run to six digits); USD needs a
  // decimal point instead. The rest of the pad is identical, so the keys do
  // not jump around when the cursor moves.
  const keypadKeys: string[] =
    activeField === "LL"
      ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"];

  const hasEntry = amountPaidLL.length > 0 || amountPaidUSD.length > 0;

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

      {/* ---- Body ----
           One column on a phone, exactly as before. From md up it becomes two:
           what the cashier READS on the left, what they TOUCH on the right.
           Stretched full width, the keypad's three columns were ~250px per key
           on a 1366px till — a mouse target the size of a playing card, sitting
           a screen away from the amount it was entering. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:mx-auto md:w-full md:max-w-5xl md:flex-row md:gap-6 md:px-6 md:pb-4">

      {/* ---- Information column ----
           Everything above the keypad shares one shrinkable, scrollable
           region. On a normal phone nothing scrolls; on a very short one this
           gives way rather than crushing the keypad below a usable key size,
           which is the one thing on this screen that must stay thumb-sized. */}
      <div className="no-scrollbar min-h-0 shrink overflow-y-auto md:min-w-0 md:flex-1 md:shrink">
      {/* ---- Amount due ---- */}
      <div className="px-5 pt-5">
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

      {/* ---- Received: both tenders, always visible ---- */}
      <div className="px-5 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Received
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasEntry}
            className="tap -mr-1 rounded-lg px-1.5 py-0.5 text-sm font-bold text-destructive disabled:pointer-events-none disabled:opacity-30"
          >
            Clear
          </button>
        </div>

        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(["LL", "USD"] as PayField[]).map((field) => {
            const isActive = activeField === field;
            const raw = field === "LL" ? amountPaidLL : amountPaidUSD;
            // The LL figure is grouped as you type (200000 → 200,000); the USD
            // figure is shown raw so a half-typed "2." does not disappear.
            const display =
              field === "LL" ? (raw ? formatLLParts(paidLL).value : "0") : `$${raw || "0"}`;

            return (
              <button
                key={field}
                type="button"
                onClick={() => {
                  vibrate(8);
                  setActiveField(field);
                }}
                aria-pressed={isActive}
                aria-label={`Amount received in ${field}`}
                className={cn(
                  "tap rounded-2xl border px-3.5 py-2.5 text-left transition-colors",
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-white/10 bg-muted/30"
                )}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-[0.14em]",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {field}
                  </span>
                  {raw.length > 0 && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
                <span className="mt-0.5 flex items-baseline">
                  <span
                    className={cn(
                      "text-[26px] font-extrabold leading-tight tnum",
                      raw.length > 0 ? "text-foreground" : "text-muted-foreground/40"
                    )}
                  >
                    {display}
                  </span>
                  {isActive && (
                    <span className="ml-0.5 h-6 w-px animate-pulse bg-primary" aria-hidden />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* What the two tenders add up to, and the rate that got them there —
            so a split payment can be checked against the notes in hand. */}
        <div className="mt-2 flex items-baseline justify-between gap-3 px-0.5 text-xs">
          <span className="min-w-0 truncate text-muted-foreground tnum">
            {paidUSD > 0
              ? `${formatUSD(paidUSD)} @ ${formatLL(RETURN_RATE)}/$ = ${formatLL(usdAsLl)}`
              : "Tap a field, then use the keypad"}
          </span>
          <span className="flex-none font-semibold tnum">
            Total {formatLL(totalPaid)}
          </span>
        </div>
      </div>

      {/* ---- Balance, in both currencies ---- */}
      <div className="px-5 pb-1 pt-3">
        <div
          className={cn(
            "rounded-2xl border px-4 py-3 transition-colors",
            totalPaid <= 0
              ? "border-white/10"
              : displayChangeLL > 0 && !isChangeDue
                ? "border-primary/40 bg-primary/[0.07]"
                : "border-emerald-500/40 bg-emerald-500/[0.07]"
          )}
        >
          {totalPaid <= 0 ? (
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Change due
              </span>
              <span className="text-lg font-bold text-muted-foreground tnum">—</span>
            </div>
          ) : displayChangeLL === 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-emerald-400">Exact payment</span>
              <Check className="h-5 w-5 text-emerald-400" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "flex-none text-[11px] font-bold uppercase tracking-[0.14em]",
                    isChangeDue ? "text-emerald-400" : "text-primary"
                  )}
                >
                  {isChangeDue ? "Change due" : "Still due"}
                </span>
                <span className="truncate text-[11px] text-muted-foreground tnum">
                  {getChangeRateLabel()}
                </span>
              </div>
              {/* Both currencies together: the cashier may hand back either. */}
              <div
                key={displayChangeLL}
                className="animate-value-bump mt-1 flex items-baseline justify-between gap-3"
              >
                <span
                  className={cn(
                    "text-[28px] font-extrabold leading-none tnum",
                    isChangeDue ? "text-emerald-400" : "text-primary"
                  )}
                >
                  {formatLLParts(displayChangeLL).value}
                  <span className="ml-1 text-sm font-bold">
                    {formatLLParts(displayChangeLL).unit}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xl font-bold tnum",
                    isChangeDue ? "text-emerald-400/80" : "text-primary/80"
                  )}
                >
                  {formatUSD(displayChangeUSD)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- What is being paid for (desktop only) ----
           On a phone this lives behind the "N items" button, because there is
           no room for it beside the keypad. A desktop till has a whole empty
           column next to the entry panel, and a cashier taking cash while the
           customer watches should not have to open a dialog to answer "what am
           I paying for?". Same data as the summary dialog. */}
      <div className="hidden md:mt-4 md:block">
        <div className="rounded-2xl border bg-card/40 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In this sale
            </h2>
            <span className="text-xs text-muted-foreground tnum">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="no-scrollbar max-h-[34vh] space-y-2.5 overflow-y-auto">
            {items.map((item) => (
              <div key={item.product_id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">
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
        </div>
      </div>

      </div>

      {/* ---- Entry column ----
           Keypad + confirm travel together: on desktop they are the whole
           right-hand panel, at a width that keeps keys thumb-sized rather
           than letting them sprawl. */}
      <div className="flex min-h-0 flex-1 flex-col md:w-[380px] md:flex-none">

      {/* ---- Keypad ---- */}
      <div className="grid min-h-[212px] flex-1 shrink-0 grid-cols-3 auto-rows-fr gap-2 px-5 py-3">
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
          onClick={() => handleProcessPayment()}
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
              <span className="ml-1 text-xs font-semibold opacity-60">F4</span>
            </>
          )}
        </button>
      </div>

      </div>{/* /entry column */}
      </div>{/* /body */}

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
