"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { toast } from "sonner";
import { formatLL, formatUSD, formatDateTime, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";

const supabase = createClient();

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [amountPaidLL, setAmountPaidLL] = useState<string>("");
  const [amountPaidUSD, setAmountPaidUSD] = useState<string>("");
  const [whatsappNumber, setWhatsappNumber] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [transactionNumber, setTransactionNumber] = useState<string>("");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [changeGiven, setChangeGiven] = useState<number>(0);
  const [changeUsd, setChangeUsd] = useState<number>(0);

  const {
    items,
    getSubtotal,
    getSubtotalUsd,
    getTotal,
    getTotalUsd,
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

      // Sync inventory: decrement stock if online
      if (navigator.onLine) {
        const stockDecrements = items.map((item) =>
          supabase.rpc("decrement_stock", {
            product_id: item.product_id,
            quantity: item.quantity,
          })
        );
        await Promise.allSettled(stockDecrements);
      }

      // Transaction complete — just show receipt
      setTransactionComplete(true);
      toast.success("Payment processed successfully!");

      // Handle WhatsApp receipt
      if (whatsappNumber && whatsappNumber.trim()) {
        try {
          const cleanNumber = whatsappNumber.replace(/\D/g, '');
          if (cleanNumber.length === 8) {
            const phoneNumber = `961${cleanNumber}`;

            let storeName = "TableMind Store";
            try {
              const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
              if (authData.username) {
                storeName = authData.username;
              }
            } catch (e) {
              // Use default store name
            }

            const receiptLines: string[] = [];
            receiptLines.push(`*${storeName}*`);
            receiptLines.push("");
            receiptLines.push(`Transaction: #${txnNumber}`);
            receiptLines.push(`Date: ${formatDateTime(new Date().toISOString())}`);
            receiptLines.push("");
            receiptLines.push("*Items:*");

            items.forEach((item) => {
              receiptLines.push(`${item.product_name} x${item.quantity} - ${formatLL(item.total_price)}`);
            });

            receiptLines.push("");
            receiptLines.push(`*Total:* ${formatLL(total)}`);
            if (paidUSD > 0) {
              receiptLines.push(`*Paid in USD:* ${formatUSD(paidUSD)}`);
            }
            if (paidLL > 0) {
              receiptLines.push(`*Paid in LL:* ${formatLL(paidLL)}`);
            }
            receiptLines.push(`*Total Paid:* ${formatLL(totalPaid)}`);
            receiptLines.push(`*Change:* ${formatLL(calculatedChangeGiven)} (${formatUSD(calcChangeUsd)})`);
            receiptLines.push("");
            receiptLines.push("Status: ✓ Paid");
            receiptLines.push("Thank you for your purchase!");

            const receiptText = encodeURIComponent(receiptLines.join("\n"));
            const whatsappUrl = `https://wa.me/${phoneNumber}?text=${receiptText}`;

            setTimeout(() => {
              try {
                window.open(whatsappUrl, '_blank');
              } catch (waError) {
                console.warn("Could not open WhatsApp:", waError);
              }
            }, 1000);
          }
        } catch (whatsappError) {
          console.warn("WhatsApp receipt failed, continuing anyway:", whatsappError);
        }
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
        <div className="max-w-md mx-auto space-y-6">
              {/* Order Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Order Summary</CardTitle>
                  <CardDescription>
                    {items.length} item{items.length !== 1 ? "s" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
              </Card>

          {/* WhatsApp Receipt Option */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                WhatsApp Receipt
              </CardTitle>
              <CardDescription>
                Optional: Send receipt via WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="whatsapp">WhatsApp Number</Label>
                <Input
                  id="whatsapp"
                  type="tel"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">
                  Enter Lebanese number starting with 70, 71, 76, etc. (no +961 or 00961 prefix)
                </p>
              </div>
            </CardContent>
          </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Payment Method</CardTitle>
        </CardHeader>
        <CardContent>
           <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
               <div>
                 <Label htmlFor="amountLL">Amount Received (LL)</Label>
                <Input
                  id="amountLL"
                  type="number"
                  step="1"
                  value={amountPaidLL}
                  onChange={(e) => setAmountPaidLL(e.target.value)}
                  className="text-lg mt-1"
                />
               </div>

               <div>
                 <Label htmlFor="amountUSD">Amount Received (USD)</Label>
                <Input
                  id="amountUSD"
                  type="number"
                  step="0.01"
                  value={amountPaidUSD}
                  onChange={(e) => setAmountPaidUSD(e.target.value)}
                  className="text-lg mt-1"
                />
               </div>
             </div>

             {/* Payment Breakdown */}
             {(paidLL > 0 || paidUSD > 0) && (
               <div className="text-sm text-muted-foreground space-y-1 px-1">
                 {paidLL > 0 && (
                   <div className="flex justify-between">
                     <span>Paid in LL</span>
                     <span>{formatLL(paidLL)}</span>
                   </div>
                 )}
                 {paidUSD > 0 && (
                   <div className="flex justify-between">
                     <span>Paid in USD</span>
                     <span>{formatUSD(paidUSD)}</span>
                   </div>
                 )}
                 {paidUSD > 0 && (
                   <div className="flex justify-between text-xs">
                     <span>USD rate applied</span>
                     <span>$1 = {formatLL(RETURN_RATE)}</span>
                   </div>
                 )}
                 <div className="flex justify-between border-t border-border/50 pt-1 font-medium">
                   <span>Total Paid (LL equivalent)</span>
                   <span>{formatLL(totalPaid)}</span>
                 </div>
               </div>
             )}

             {/* Balance Display - always calculate live */}
             {totalPaid > 0 && (
               isChangeDue ? (
                 <div className="p-4 bg-green-500/10 rounded-lg">
                   <div className="text-green-600 font-medium mb-2">Change Due</div>
                   <div className="flex justify-between items-center">
                     <span className="text-green-600">in LL</span>
                     <span className="text-2xl font-bold text-green-600">
                       {formatLL(displayChangeLL)}
                     </span>
                   </div>
                   <div className="flex justify-between items-center mt-1">
                     <span className="text-green-600">in USD</span>
                     <span className="text-xl font-bold text-green-600">
                       {formatUSD(displayChangeUSD)}
                     </span>
                   </div>
                   <div className="flex justify-between text-xs text-green-600/70 mt-2 pt-1 border-t border-green-600/20">
                     <span>Rate applied for this transaction</span>
                     <span>{getChangeRateLabel()}</span>
                   </div>
                 </div>
               ) : (
                 <div className="p-4 bg-amber-500/10 rounded-lg">
                   <div className="text-amber-600 font-medium mb-1">Remaining Due</div>
                   <div className="flex justify-between items-center">
                     <span className="text-2xl font-bold text-amber-600">
                       {formatLL(displayChangeLL)}
                     </span>
                     <span className="text-amber-600 font-medium">
                       {formatUSD(displayChangeLL / SELL_RATE)}
                     </span>
                   </div>
                 </div>
               )
             )}

             {/* Calculator hint */}
             {total > 0 && (
               <div className="flex items-center gap-2 text-sm text-muted-foreground">
                 <Calculator className="h-4 w-4" />
                 <span>
                   Total: {formatLL(total)} / {formatUSD(totalUsd)}
                 </span>
               </div>
             )}
           </div>
         </CardContent>
          </Card>

          {/* Process Payment Button */}
          <Button
            className="w-full h-14 text-lg"
            onClick={handleProcessPayment}
             disabled={
               isProcessing ||
               totalPaid < total
             }
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
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}