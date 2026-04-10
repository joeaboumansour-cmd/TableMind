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
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { toast } from "sonner";
import { formatCurrency, formatLL, convertUsdToLl, formatUSD, formatDateTime } from "@/lib/utils/format";

const supabase = createClient();

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentMethod = searchParams.get("method") || "cash";

  const [amountPaid, setAmountPaid] = useState<string>("");
  const [whatsappNumber, setWhatsappNumber] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [transactionNumber, setTransactionNumber] = useState<string>("");
  const [change, setChange] = useState<number>(0);
  const [whatsappRedirectUrl, setWhatsappRedirectUrl] = useState<string>("");

  const {
    items,
    store_id,
    getSubtotal,
    getTotal,
    clearCart,
  } = useCartStore();

  const total = getTotal();

  // Calculate change for cash payments
  useEffect(() => {
    if (paymentMethod === "cash" && amountPaid) {
      const paid = parseFloat(amountPaid);
      if (!isNaN(paid) && paid >= total) {
        setChange(paid - total);
      } else {
        setChange(0);
      }
    }
  }, [amountPaid, total, paymentMethod]);

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

    if (paymentMethod === "cash") {
      const paid = parseFloat(amountPaid);
      if (isNaN(paid) || paid < total) {
        toast.error("Insufficient payment amount");
        return;
      }
    }

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

      // Create transaction record
      const { data: transaction, error: transactionError } = await supabase
        .from("transactions")
        .insert({
          store_id: store_id,
          transaction_number: txnNumber,
          subtotal: getSubtotal(),
          total_amount: total,
          amount_paid: paymentMethod === "cash" ? parseFloat(amountPaid) : total,
          change_given: paymentMethod === "cash" ? change : 0,
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
           
           // Add paid and change for cash payments
           if (paymentMethod === "cash") {
             receiptLines.push(`*Paid:* ${formatLL(parseFloat(amountPaid))}`);
             receiptLines.push(`*Change:* ${formatLL(change)}`);
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
                <span>Total Paid</span>
                <span className="font-bold">{formatLL(total)}</span>
              </div>
              {paymentMethod === "cash" && change > 0 && (
                <div className="flex justify-between text-green-500">
                  <span>Change</span>
                  <span className="font-bold">{formatLL(change)}</span>
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
                {paymentMethod === "cash" ? "Cash Payment" : "Card Payment"}
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
                    <span className="font-medium">{formatLL(item.total_price)}</span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

                <div className="space-y-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-amber-500">{formatLL(total)}</span>
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
              <CardTitle className="flex items-center gap-2">
                {paymentMethod === "cash" ? (
                  <>
                    <Banknote className="h-5 w-5" />
                    Cash Payment
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5" />
                    Card Payment
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {paymentMethod === "cash" ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="amount">Amount Received (LL)</Label>
                    <div className="relative mt-1">
                      <Input
                        id="amount"
                        type="number"
                        step="1"
                        min={total}
                        placeholder={total.toString()}
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        className="text-lg"
                      />
                    </div>
                  </div>

                  {/* Change Display */}
                  {change > 0 && (
                    <div className="p-4 bg-green-500/10 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-green-600 font-medium">Change Due</span>
                        <span className="text-2xl font-bold text-green-600">
                          {formatLL(change)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Calculator hint */}
                  {total > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calculator className="h-4 w-4" />
                      <span>
                        Minimum: {formatLL(total)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    Ready to process card payment
                  </p>
                  <p className="text-2xl font-bold mt-2">{formatLL(total)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Process Payment Button */}
          <Button
            className="w-full h-14 text-lg"
            onClick={handleProcessPayment}
            disabled={
              isProcessing ||
              (paymentMethod === "cash" && (parseFloat(amountPaid) < total || !amountPaid))
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