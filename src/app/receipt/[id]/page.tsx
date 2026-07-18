"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  Share2,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import { usePermissionGuard } from "@/lib/auth/usePermissionGuard";

const supabase = createClient();

interface Transaction {
  id: string;
  transaction_number: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
}

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export default function ReceiptPage() {
  const router = useRouter();
  const params = useParams();
  const transactionNumber = params.id as string;
  // Permission check
  usePermissionGuard("receipts");

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTransaction = async () => {
      try {
        // Get store auth
        const authData = localStorage.getItem("goldensquirrel_auth");
        if (!authData) {
          router.push("/login");
          return;
        }

        const { store_id } = JSON.parse(authData);

        // Fetch transaction for this store
        const { data: txnData, error: txnError } = await supabase
          .from("transactions")
          .select("*")
          .eq("transaction_number", transactionNumber)
          .eq("store_id", store_id)
          .single();

        if (txnError) throw txnError;
        setTransaction(txnData);

        // Fetch transaction items
        const { data: itemsData, error: itemsError } = await supabase
          .from("transaction_items")
          .select("*")
          .eq("transaction_id", txnData.id)
          .order("created_at");

        if (itemsError) throw itemsError;
        setItems(itemsData || []);
      } catch (error) {
        console.error("Error fetching transaction:", error);
        toast.error("Transaction not found");
        router.push("/pos");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTransaction();
  }, [transactionNumber, router, supabase]);

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Receipt - ${transactionNumber}`,
          text: `Transaction ${transactionNumber} - Total: ${formatCurrency(transaction?.total_amount || 0)}`,
          url: window.location.href,
        });
      } catch (error) {
        // User cancelled share
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
          <p className="mt-4 text-muted-foreground">Loading receipt...</p>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b print:hidden">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-bold text-lg">Receipt</h1>
                <p className="text-sm text-muted-foreground">
                  #{transaction.transaction_number}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="max-w-md mx-auto">
          <Card className="print:shadow-none print:border-none">
            <CardContent className="pt-6">
              {/* Receipt Header */}
              <div className="text-center mb-6">
                <div className="h-16 w-16 rounded-full bg-amber-500 flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 32 32" className="h-10 w-10 text-white" fill="currentColor">
                    <ellipse cx="18" cy="22" rx="6" ry="7" />
                    <circle cx="24" cy="14" r="5" />
                    <ellipse cx="28" cy="15" rx="3" ry="2.5" />
                    <path d="M22 10 L24 6 L26 10 Z" />
                    <circle cx="25" cy="13" r="1.2" fill="#FEF3C7" />
                    <ellipse cx="22" cy="20" rx="2" ry="3" />
                    <ellipse cx="14" cy="24" rx="2.5" ry="4" />
                    <path d="M12 20 C 8 18, 6 14, 6 10 C 6 4, 10 2, 14 4 C 17 5, 18 8, 16 10 C 14 12, 11 10, 12 8 C 12 6, 14 6, 15 7 C 16 8, 16 10, 14 12 C 12 14, 10 16, 12 20 Z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold">GoldenSquirrel</h2>
                <p className="text-sm text-muted-foreground">Point of Sale Receipt</p>
              </div>

              {/* Transaction Info */}
              <div className="space-y-2 text-sm mb-6">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transaction #</span>
                  <span className="font-mono">{transaction.transaction_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span>{formatDateTime(transaction.created_at)}</span>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Items */}
              <div className="space-y-3 mb-6">
                {items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{item.product_name}</p>
                      <p className="text-muted-foreground">
                        {formatCurrency(item.unit_price)} × {item.quantity}
                      </p>
                    </div>
                    <span className="font-medium">{formatCurrency(item.total_price)}</span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              {/* Totals */}
              <div className="space-y-2">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span className="text-amber-500">{formatCurrency(transaction.total_amount)}</span>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Payment Info */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span>{formatCurrency(transaction.amount_paid)}</span>
                </div>
                {transaction.change_given > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Change</span>
                    <span>{formatCurrency(transaction.change_given)}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="mt-6 pt-6 border-t text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Thank you for your business!
                </p>
                <p className="text-xs text-muted-foreground">
                  Powered by GoldenSquirrel POS
                </p>
              </div>

            </CardContent>
          </Card>

          {/* Actions */}
          <div className="mt-6 space-y-2 print:hidden">
            <Button className="w-full" onClick={() => router.push("/pos")}>
              New Transaction
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}