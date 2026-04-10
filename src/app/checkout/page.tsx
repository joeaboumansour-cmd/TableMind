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
  Banknote,
  CreditCard,
  Receipt,
  Check,
  Loader2,
  Calculator,
  DollarSign,
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { toast } from "sonner";
import { formatCurrency, formatLL, convertUsdToLl, formatUSD, formatDateTime, convertLlToUsdForReturn, convertLlToUsdForSale, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";

const supabase = createClient();

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [paymentMethod, setPaymentMethod] = useState(searchParams.get("method") || "cash");

  const [amountPaidLL, setAmountPaidLL] = useState<string>("");
  const [amountPaidUSD, setAmountPaidUSD] = useState<string>("");
  const [whatsappNumber, setWhatsappNumber] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [transactionNumber, setTransactionNumber] = useState<string>("");
  const [whatsappRedirectUrl, setWhatsappRedirectUrl] = useState<string>("");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [changeGiven, setChangeGiven] = useState<number>(0);
  const [changeUsd, setChangeUsd] = useState<number>(0);

  const {
    items,
    store_id,
    getSubtotal,
    getSubtotalUsd,
    getTotal,
    getTotalUsd,
    clearCart,
  } = useCartStore();

  const total = getTotal();
  const totalUsd = getTotalUsd();

  // Calculate total paid - simple direct calculation
  const paidLL = parseFloat(amountPaidLL) || 0;
  const paidUSD = parseFloat(amountPaidUSD) || 0;
  const totalPaid = paidLL + (paidUSD * SELL_RATE);
  
  // Simple balance calculation: whatever was entered minus total
  const difference = totalPaid - total;
  
  const isChangeDue = difference > 0;
  const isExactMatch = difference === 0;
  const displayAmount = Math.abs(difference);

  // No auto-sync effects - user controls both fields manually

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

  const paymentMethodUsed = "cash";
  const calculatedPaidAmount = totalPaid;

    setIsProcessing(true);

    try {
      const txnNumber = generateTransactionNumber();
      setTransactionNumber(txnNumber);

      // Get auth data
      const authData = localStorage.getItem("goldensquirrel_auth");
      if (!authData) {
        router.push("/login");
        return;
      }

      const { store_id } = JSON.parse(authData);

      // Calculate USD amounts
      const subtotalUsd = getSubtotalUsd();
      const calculatedChangeGiven = calculatedPaidAmount - total;
      const calculatedChangeUsd = calculatedChangeGiven / SELL_RATE;

      setPaidAmount(calculatedPaidAmount);
      setChangeGiven(calculatedChangeGiven);
      setChangeUsd(calculatedChangeUsd);

      // Create transaction record
      const { data: transaction, error: transactionError } = await supabase
        .from("transactions")
        .insert({
          store_id: store_id,
          transaction_number: txnNumber,
          subtotal: getSubtotal(),
          total_amount: total,
          amount_paid: calculatedPaidAmount,
          change_given: calculatedChangeGiven,
          usd_subtotal: subtotalUsd,
          usd_total_amount: totalUsd,
          usd_amount_paid: convertLlToUsdForSale(calculatedPaidAmount),
          usd_change_given: calculatedChangeUsd,
        })
        .select()
        .single();

      if (transactionError) throw transactionError;

      // Create transaction items
      const transactionItems = items.map((item) => ({
        store_id: store_id,
        transaction_id: transaction.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
      }));

      const { error: itemsError } = await supabase
        .from("transaction_items")
        .insert(transactionItems);

      if (itemsError) throw itemsError;

      // Update product stock quantities
      for (const item of items) {
        const { error: stockError } = await supabase.rpc("decrement_stock", {
          product_id: item.product_id,
          quantity: item.quantity,
        });

        if (stockError) {
          console.error("Error updating stock:", stockError);
        }
      }

      setTransactionComplete(true);
      toast.success("Payment processed successfully!");
      
      // Handle WhatsApp receipt
      if (whatsappNumber && whatsappNumber.trim()) {
        // Format the WhatsApp number - ensure it's 8 digits (Lebanese local format)
        const cleanNumber = whatsappNumber.replace(/\D/g, '');
        if (cleanNumber.length === 8) {
          // Always add 00961 before the number as specified in requirements
          const phoneNumber = `${cleanNumber}`;
          
          // Parse auth data to get username for store name
          let storeName = "TableMind Store";
          try {
            const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
            if (authData.username) {
              storeName = authData.username;
            }
          } catch (e) {
            // Use default store name if auth data parsing fails
          }
          
           // Build receipt lines array
           const receiptLines: string[] = [];
           receiptLines.push(`*${storeName}*`);
           receiptLines.push(`Transaction: #${txnNumber}`);
           receiptLines.push(`Date: ${formatDateTime(new Date().toISOString())}`);
           receiptLines.push("");
           receiptLines.push("*Items:*");

           // Add each item with price
           items.forEach((item) => {
             receiptLines.push(`${item.product_name} x${item.quantity} - ${formatLL(item.total_price)}`);
           });

           receiptLines.push("");
           receiptLines.push(`*Subtotal:* ${formatLL(getSubtotal())}`);
           receiptLines.push(`*Total:* ${formatLL(total)}`);
           
           // Add paid and change based on payment method
            if (paymentMethodUsed === "cash") {
              receiptLines.push(`*Paid:* ${formatLL(calculatedPaidAmount)}`);
              receiptLines.push(`*Change:* ${formatLL(calculatedChangeGiven)}`);
            } else if (paymentMethodUsed === "usd") {
              receiptLines.push(`*Paid:* $${formatUSD(calculatedPaidAmount / SELL_RATE)}`);
              receiptLines.push(`*Change:* $${formatUSD(calculatedChangeUsd)}`);
            }

           receiptLines.push("");
           receiptLines.push("Status: ✓ Paid");
           receiptLines.push("Thank you for your purchase!");
          
          // Join with URL-encoded line breaks
          const receiptText = encodeURIComponent(receiptLines.join("\n"));
          
          // Construct WhatsApp URL
          const whatsappUrl = `https://wa.me/${phoneNumber}?text=${receiptText}`;
          setWhatsappRedirectUrl(whatsappUrl);
          
          // Redirect to WhatsApp after a short delay
          setTimeout(() => {
            window.open(whatsappUrl, '_blank');
          }, 1000);
        }
      }
    } catch (error) {
      console.error("Error processing payment:", JSON.stringify(error, null, 2));
      toast.error(error.message || "Failed to process payment");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle new transaction
  const handleNewTransaction = () => {
    clearCart();
    router.push("/pos");
  };

  // Quick cash amounts
  const quickCashAmounts = [5, 10, 20, 50, 100];

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
               {changeGiven > 0 && (
                 <div className="flex justify-between text-green-500">
                   <span>Change</span>
                   <span className="font-bold">{formatLL(changeGiven)}</span>
                   <span className="text-sm">(${formatUSD(changeUsd)})</span>
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
                    <span>
                      {item.product_name} × {item.quantity}
                    </span>
                    <span className="text-right">
                      <div className="font-medium">{formatLL(item.total_price)}</div>
                      <div className="text-xs text-muted-foreground">{formatUSD(item.total_price_usd)}</div>
                    </span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

                <div className="space-y-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-right">
                      <div className="text-amber-500">{formatLL(total)}</div>
                      <div className="text-s text-muted-foreground">{formatUSD(totalUsd)}</div>
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
                  placeholder="70123456"
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
                   placeholder={total.toString()}
                   value={amountPaidLL}
                   onChange={(e) => {
                     setAmountPaidLL(e.target.value);
                     setAmountPaidUSD("");
                   }}
                   className="text-lg mt-1"
                 />
               </div>

               <div>
                 <Label htmlFor="amountUSD">Amount Received (USD)</Label>
                 <Input
                   id="amountUSD"
                   type="number"
                   step="0.01"
                   placeholder={totalUsd.toString()}
                   value={amountPaidUSD}
                   onChange={(e) => {
                     setAmountPaidUSD(e.target.value);
                     setAmountPaidLL("");
                   }}
                   className="text-lg mt-1"
                 />
               </div>
             </div>

             {/* Balance Display - always calculate live */}
             {totalPaid > 0 && (
               isChangeDue ? (
                 <div className="p-4 bg-green-500/10 rounded-lg">
                   <div className="text-green-600 font-medium mb-1">Change Due</div>
                   <div className="flex justify-between items-center">
                     <span className="text-2xl font-bold text-green-600">
                       {formatLL(displayAmount)}
                     </span>
                     <span className="text-green-600 font-medium">
                       {formatUSD(displayAmount / SELL_RATE)}
                     </span>
                   </div>
                 </div>
               ) : (
                 <div className="p-4 bg-amber-500/10 rounded-lg">
                   <div className="text-amber-600 font-medium mb-1">Remaining Due</div>
                   <div className="flex justify-between items-center">
                     <span className="text-2xl font-bold text-amber-600">
                       {formatLL(displayAmount)}
                     </span>
                     <span className="text-amber-600 font-medium">
                       {formatUSD(displayAmount / SELL_RATE)}
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