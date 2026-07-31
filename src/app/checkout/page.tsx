"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Check,
  Loader2,
  Calculator,
  ChevronDown,
  ChevronUp,
  X,
  Banknote,
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { queueStockDecrementsForTransaction } from "@/lib/db";
import { toast } from "sonner";
import { formatLL, formatUSD, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";

// ── Common bill / coin denominations ──
const LL_DENOMINATIONS = [
  { label: "5K", value: 5000 },
  { label: "10K", value: 10000 },
  { label: "20K", value: 20000 },
  { label: "50K", value: 50000 },
  { label: "100K", value: 100000 },
];
const USD_DENOMINATIONS = [
  { label: "$1", value: 1 },
  { label: "$5", value: 5 },
  { label: "$10", value: 10 },
  { label: "$20", value: 20 },
  { label: "$50", value: 50 },
  { label: "$100", value: 100 },
];

function CheckoutContent() {
  const router = useRouter();

  const [amountPaidLL, setAmountPaidLL] = useState<string>("");
  const [amountPaidUSD, setAmountPaidUSD] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [transactionNumber, setTransactionNumber] = useState<string>("");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [changeGiven, setChangeGiven] = useState<number>(0);
  const [changeUsd, setChangeUsd] = useState<number>(0);
  const [showSummary, setShowSummary] = useState(true);

  const llInputRef = useRef<HTMLInputElement>(null);

  const {
    items,
    getSubtotal,
    getSubtotalUsd,
    getTotal,
    getTotalUsd,
    getTotalDiscount,
    getTotalOriginal,
    clearCart,
  } = useCartStore();

  const total = getTotal();
  const totalUsd = getTotalUsd();

  // Calculate total paid - combine both currencies
  // USD is valued at RETURN_RATE (89,000) so the store wins on incoming USD
  const paidLL = parseFloat(amountPaidLL) || 0;
  const paidUSD = parseFloat(amountPaidUSD) || 0;
  const totalPaid = paidLL + (paidUSD * RETURN_RATE);

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
    // Both: weighted average of rates by contribution to total
    const llWeight = paidLL / totalPaid;
    const usdWeight = (paidUSD * RETURN_RATE) / totalPaid;
    return (llWeight * SELL_RATE) + (usdWeight * RETURN_RATE);
  }

  function getChangeRateLabel(): string {
    if (paidUSD > 0 && paidLL === 0) return `$1 = ${formatLL(RETURN_RATE)}`;
    if (paidLL > 0 && paidUSD === 0) return `$1 = ${formatLL(SELL_RATE)}`;
    return `blended $1 ≈ ${formatLL(Math.round(getChangeRate()))}`;
  }

  const changeRate = getChangeRate();
  const displayChangeUSD = displayChangeLL / changeRate;

  // Auto-focus the LL amount input so the cashier can start typing immediately
  useEffect(() => {
    const timer = setTimeout(() => {
      llInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Auto-collapse the order summary once payment entry begins,
  // keeping the cashier focused on the amounts and change
  useEffect(() => {
    if ((paidLL > 0 || paidUSD > 0) && showSummary) {
      setShowSummary(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidLL, paidUSD]);

  // ── Bill denomination buttons — repeatedly click to keep adding ──
  // Cashiers correct mistakes by editing the text field directly
  const handleQuickLL = (amount: number) => {
    const current = parseFloat(amountPaidLL) || 0;
    setAmountPaidLL(String(current + amount));
  };

  const handleQuickUSD = (amount: number) => {
    const current = parseFloat(amountPaidUSD) || 0;
    const newValue = current + amount;
    setAmountPaidUSD(newValue % 1 === 0 ? String(newValue) : newValue.toFixed(2));
  };

  // ── Clear all payment fields ──
  const handleClear = () => {
    setAmountPaidLL("");
    setAmountPaidUSD("");
  };

  // Generate transaction number
  const generateTransactionNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
  };

  // Handle payment processing — local only, no database writes
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
        } catch (error) {
          console.error("Failed to save transaction online:", error);
          toast.error("Payment processed but failed to save receipt");
        }
      } else {
        // Offline: Queue for later sync
        const { queueTransaction } = await import("@/lib/db/localDB");
        const authDataOffline = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
        // Ensure store_id is never empty - try multiple fallbacks
        const offlineStoreId = authDataOffline.store_id || "";
        const offlineTxnData: any = {
          id: crypto.randomUUID(),
          store_id: offlineStoreId,
          transaction_number: txnNumber,
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
        await queueTransaction(offlineTxnData);

        // Queue stock decrements as pending_writes for reliable sync
        await queueStockDecrementsForTransaction(
          items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          offlineStoreId
        );

        toast.info("Transaction saved offline - will sync when online");
      }

      // Transaction complete — just show receipt
      setTransactionComplete(true);
      toast.success("Payment processed successfully!");
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
    router.push("/pos");
  };

  if (transactionComplete) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Payment Complete!</h2>
            <p className="text-muted-foreground mb-4">
              Transaction #{transactionNumber}
            </p>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between">
                <span>Total Amount</span>
                <span className="font-bold">{formatLL(total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount Paid</span>
                <span className="font-bold">{formatLL(paidAmount)}</span>
              </div>
              {paidUSD > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>of which USD</span>
                  <span>{formatUSD(paidUSD)} @ {formatLL(RETURN_RATE)}/USD</span>
                </div>
              )}
              {changeGiven > 0 && (
                <div className="flex justify-between text-green-500">
                  <span>Change</span>
                  <span className="font-bold">{formatLL(changeGiven)}</span>
                  <span className="text-sm">({formatUSD(changeUsd)})</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Button variant="outline" className="w-full" onClick={handleNewTransaction}>
                New Transaction
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-bold text-lg">Checkout</h1>
              <p className="text-sm text-muted-foreground">
                Cash Payment
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="max-w-md mx-auto space-y-4">
          {/* ── Payment Method ── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Payment Method</CardTitle>
                {/* Clear button — empties both payment fields */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                  onClick={handleClear}
                  title="Clear all payment amounts"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Amount Received Inputs — full width so cashiers can see the entire number */}
              <div className="grid grid-cols-2 gap-4">
                {/* LL Input */}
                <div>
                  <Label htmlFor="amountLL" className="flex items-center gap-1">
                    <Banknote className="h-4 w-4" />
                    Amount Received (LL)
                  </Label>
                  <Input
                    ref={llInputRef}
                    id="amountLL"
                    type="number"
                    step="1"
                    inputMode="numeric"
                    value={amountPaidLL}
                    onChange={(e) => setAmountPaidLL(e.target.value)}
                    className="text-lg mt-1"
                    placeholder="0"
                  />
                </div>

                {/* USD Input */}
                <div>
                  <Label htmlFor="amountUSD" className="flex items-center gap-1">
                    <Banknote className="h-4 w-4" />
                    Amount Received (USD)
                  </Label>
                  <Input
                    id="amountUSD"
                    type="number"
                    step="1"
                    inputMode="numeric"
                    value={amountPaidUSD}
                    onChange={(e) => setAmountPaidUSD(e.target.value)}
                    className="text-lg mt-1"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* ── Bill denomination buttons (LL) ── */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Lebanese Pounds
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {LL_DENOMINATIONS.map((denom) => {
                    const current = parseFloat(amountPaidLL) || 0;
                    const isActive = current === denom.value;
                    return (
                      <Button
                        key={denom.value}
                        variant="default"
                        size="sm"
                        className={`text-xs font-bold py-3 h-auto transition-all ${
                          isActive
                            ? "bg-green-600 hover:bg-green-700 active:scale-95 ring-2 ring-primary ring-offset-2"
                            : "bg-green-600 hover:bg-green-700 active:scale-95"
                        }`}
                        onClick={() => handleQuickLL(denom.value)}
                        title={`Add ${formatLL(denom.value)}`}
                      >
                        {denom.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* ── Bill denomination buttons (USD) ── */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    US Dollars
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {USD_DENOMINATIONS.map((denom) => {
                    const current = parseFloat(amountPaidUSD) || 0;
                    const isActive = current === denom.value;
                    return (
                      <Button
                        key={denom.value}
                        variant="default"
                        size="sm"
                        className={`text-xs font-bold py-3 h-auto transition-all ${
                          isActive
                            ? "bg-blue-600 hover:bg-blue-700 active:scale-95 ring-2 ring-primary ring-offset-2"
                            : "bg-blue-600 hover:bg-blue-700 active:scale-95"
                        }`}
                        onClick={() => handleQuickUSD(denom.value)}
                        title={`Add ${formatUSD(denom.value)}`}
                      >
                        {denom.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Breakdown */}
              {(paidLL > 0 || paidUSD > 0) && (
                <div className="text-sm space-y-1.5 px-1 pt-2 border-t border-border/50">
                  {paidLL > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Paid in LL</span>
                      <span className="font-medium">{formatLL(paidLL)}</span>
                    </div>
                  )}
                  {paidUSD > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Paid in USD</span>
                      <span className="font-medium">{formatUSD(paidUSD)}</span>
                    </div>
                  )}
                  {paidUSD > 0 && paidLL === 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>USD rate applied</span>
                      <span>$1 = {formatLL(RETURN_RATE)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border/50 pt-1.5 font-medium">
                    <span>Total Paid (LL equivalent)</span>
                    <span className="text-primary">{formatLL(totalPaid)}</span>
                  </div>
                </div>
              )}

              {/* Calculator hint */}
              {total > 0 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground px-1 pt-1">
                  <span className="flex items-center gap-2">
                    <Calculator className="h-4 w-4" />
                    Total:
                  </span>
                  <span>
                    {formatLL(total)} / {formatUSD(totalUsd)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Order Summary — collapsible ── */}
          <Card>
            <button
              type="button"
              className="w-full"
              onClick={() => setShowSummary((prev) => !prev)}
              aria-expanded={showSummary}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="text-left">
                    <CardTitle className="text-sm font-medium">Order Summary</CardTitle>
                    <CardDescription>
                      {items.length} item{items.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="font-bold text-amber-500">{formatLL(total)}</div>
                      <div className="text-xs text-muted-foreground">{formatUSD(totalUsd)}</div>
                    </div>
                    {showSummary ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CardHeader>
            </button>

            {showSummary && (
              <>
                <Separator />
                <CardContent className="pt-4">
                  <div className="space-y-3 max-h-[200px] overflow-y-auto mb-4">
                    {items.map((item) => (
                      <div key={item.product_id} className="flex justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span>{item.product_name} × {item.quantity}</span>
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            {item.currency}
                          </Badge>
                        </div>
                        <span className="text-right">
                          {item.currency === 'LL' ? (
                            <>
                              <div className="font-medium">{formatLL(item.total_price)}</div>
                              <div className="text-xs text-muted-foreground">{formatUSD(item.total_price_usd)}</div>
                            </>
                          ) : (
                            <>
                              <div className="font-medium">{formatUSD(item.total_price_usd)}</div>
                              <div className="text-xs text-muted-foreground">{formatLL(item.total_price)}</div>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  <Separator className="my-4" />

                  <div className="space-y-2">
                    {/* Show discount breakdown if any */}
                    {getTotalDiscount() > 0 && (
                      <>
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>Subtotal</span>
                          <span>{formatLL(getTotalOriginal())}</span>
                        </div>
                        <div className="flex justify-between text-sm text-red-500">
                          <span>Discount</span>
                          <span>-{formatLL(getTotalDiscount())}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total</span>
                      <span className="text-right">
                        {items[0]?.currency === 'LL' ? (
                          <>
                            <div className="text-amber-500">{formatLL(total)}</div>
                            <div className="text-s text-muted-foreground">{formatUSD(totalUsd)}</div>
                          </>
                        ) : (
                          <>
                            <div className="text-amber-500">{formatUSD(totalUsd)}</div>
                            <div className="text-s text-muted-foreground">{formatLL(total)}</div>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </>
            )}
          </Card>

          {/* ── Sticky bottom bar: live change + process button ── */}
          <div className="sticky bottom-0 z-10 -mx-4 px-4 pt-3 pb-2 bg-background/95 backdrop-blur border-t border-border/60">
            {/* Balance Display - always calculate live */}
            {totalPaid > 0 && (
              <>
                {isChangeDue ? (
                  <div className="mb-3 p-3 bg-green-500/10 rounded-lg">
                    <div className="text-green-600 font-semibold mb-1 flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      Change Due
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-2xl font-bold text-green-600">
                          {formatLL(displayChangeLL)}
                        </span>
                        <span className="text-sm text-green-600/80">
                          ({formatUSD(displayChangeUSD)})
                        </span>
                      </div>
                      <span className="text-xs text-green-600/70 text-right shrink-0">
                        {getChangeRateLabel()}
                      </span>
                    </div>
                  </div>
                ) : displayChangeLL > 0 ? (
                  <div className="mb-3 p-3 bg-amber-500/10 rounded-lg">
                    <div className="text-amber-600 font-medium mb-1 flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      Remaining Due
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-2xl font-bold text-amber-600">
                        {formatLL(displayChangeLL)}
                      </span>
                      <span className="text-amber-600 font-medium">
                        {formatUSD(displayChangeLL / SELL_RATE)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 p-3 bg-green-500/10 rounded-lg flex items-center justify-between">
                    <span className="text-green-600 font-semibold">Exact payment received</span>
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                )}
              </>
            )}

            {/* Process Payment Button */}
            <Button
              className="w-full h-14 text-lg"
              onClick={handleProcessPayment}
              disabled={isProcessing || totalPaid < total}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Process Payment • {formatLL(total)}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
