"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Clock,
  Receipt,
  RefreshCw,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { formatLL, formatDateTime, formatRelativeTime, formatUSD, convertLlToUsdForSale, convertLlToUsdForReturn, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Transaction {
  id: string;
  transaction_number: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
  transaction_items: TransactionItem[];
}

interface TransactionWithChange extends Transaction {
  calculated_change: number;
}

export default function TransactionHistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionWithChange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get auth data from localStorage
      const authData = localStorage.getItem("goldensquirrel_auth");
      if (!authData) {
        router.push("/login");
        return;
      }

      const response = await fetch("/api/transactions", {
        headers: {
          "x-auth-data": authData,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Handle case where Supabase is not configured (returns empty array)
      if (!data.transactions) {
        setTransactions([]);
        return;
      }

      // Calculate change if not explicitly stored (for backwards compatibility)
      const transactionsWithChange = data.transactions.map((txn: Transaction) => ({
        ...txn,
        calculated_change: txn.change_given || (txn.amount_paid - txn.total_amount),
      }));

      setTransactions(transactionsWithChange);
    } catch (err: any) {
      console.error("Error fetching transactions:", err);
      setError(err.message || "Failed to load transaction history. Please try again.");
      toast.error(err.message || "Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Cleanup old transactions (older than 48 hours)
  const handleCleanup = async () => {
    setIsCleaning(true);

    try {
      const authData = localStorage.getItem("goldensquirrel_auth");
      if (!authData) {
        router.push("/login");
        return;
      }

      const response = await fetch("/api/transactions", {
        method: "DELETE",
        headers: {
          "x-auth-data": authData,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to cleanup transactions");
      }

      toast.success("Old transactions cleaned up");
      fetchTransactions();
    } catch (err) {
      console.error("Error cleaning up transactions:", err);
      toast.error("Failed to cleanup transactions");
    } finally {
      setIsCleaning(false);
    }
  };

  // Send transaction receipt via WhatsApp
  const handleSendWhatsApp = (transaction: TransactionWithChange) => {
    // Prompt for WhatsApp number
    const phoneNumber = prompt("Enter WhatsApp number (8 digits, e.g., 70123456):");
    
    if (!phoneNumber) return;

    // Clean and validate number
    const cleanNumber = phoneNumber.replace(/\D/g, "");
    if (cleanNumber.length !== 8) {
      toast.error("Please enter a valid 8-digit Lebanese number");
      return;
    }

    // Get store name
    let storeName = "TableMind Store";
    try {
      const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      if (authData.username) {
        storeName = authData.username;
      }
    } catch (e) {
      // Use default store name
    }

    // Build receipt
    const receiptLines: string[] = [];
    receiptLines.push(`*${storeName}*`);
    receiptLines.push(`Transaction: #${transaction.transaction_number}`);
    receiptLines.push(`Date: ${formatDateTime(transaction.created_at)}`);
    receiptLines.push("");
    receiptLines.push("*Items:*");

    transaction.transaction_items.forEach((item) => {
      receiptLines.push(
        `${item.product_name} x${item.quantity} - ${formatLL(item.total_price)}`
      );
    });

    receiptLines.push("");
    receiptLines.push(`*Subtotal:* ${formatLL(transaction.subtotal)}`);
    receiptLines.push(`*Total:* ${formatLL(transaction.total_amount)}`);
    receiptLines.push(`*Paid:* ${formatLL(transaction.amount_paid)}`);
    receiptLines.push(`*Change:* ${formatLL(transaction.calculated_change)}`);
    receiptLines.push("");
    receiptLines.push("Status: ✓ Paid");
    receiptLines.push("Thank you for your purchase!");

    const receiptText = encodeURIComponent(receiptLines.join("\n"));
    const whatsappUrl = `https://wa.me/${cleanNumber}?text=${receiptText}`;

    window.open(whatsappUrl, "_blank");
    toast.success("Opening WhatsApp...");
  };

  const toggleAccordion = (id: string) => {
    setOpenAccordion(openAccordion === id ? null : id);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading transactions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-bold text-lg">Transaction History</h1>
                <p className="text-sm text-muted-foreground">
                  Last 48 hours • {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCleanup}
                disabled={isCleaning}
                title="Clean up old transactions"
              >
                {isCleaning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchTransactions}
                disabled={isLoading}
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {error && (
          <Card className="mb-6 border-destructive">
            <CardContent className="flex items-center gap-4 pt-6">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {transactions.length === 0 && !error ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-2">No Recent Transactions</h3>
              <p className="text-muted-foreground text-center mb-4">
                No transactions found in the last 48 hours.
              </p>
              <Button onClick={() => router.push("/pos")}>
                Start New Transaction
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {transactions.map((transaction) => (
              <Collapsible
                key={transaction.id}
                open={openAccordion === transaction.id}
                onOpenChange={() => toggleAccordion(transaction.id)}
              >
                <Card className={`transition-all ${openAccordion === transaction.id ? "ring-2 ring-primary" : ""}`}>
                  {/* Summary Row - Always Visible */}
                  <CollapsibleTrigger asChild>
                    <div className="cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">
                                #{transaction.transaction_number}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {transaction.transaction_items.length} item{transaction.transaction_items.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatRelativeTime(transaction.created_at)}</span>
                              <span>•</span>
                              <span>{formatDateTime(transaction.created_at)}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-primary">
                              {formatLL(transaction.total_amount)}
                            </div>
                            {transaction.calculated_change > 0 && (
                              <div className="text-xs text-green-600">
                                Change: {formatLL(transaction.calculated_change)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-end mt-2">
                          {openAccordion === transaction.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </CardContent>
                    </div>
                  </CollapsibleTrigger>

                  {/* Expanded Details */}
                  <CollapsibleContent>
                    <Separator />
                    <CardContent className="p-4 space-y-4">
                      {/* Line Items */}
                      <div>
                        <h4 className="font-medium text-sm mb-2">Line Items</h4>
                        <div className="space-y-2">
                          {transaction.transaction_items.map((item) => (
                            <div
                              key={item.id}
                              className="flex justify-between text-sm py-2 border-b border-border/50 last:border-0"
                            >
                              <div className="flex-1">
                                <span className="font-medium">{item.product_name}</span>
                                <span className="text-muted-foreground ml-2">
                                  ×{item.quantity}
                                </span>
                              </div>
                              <div className="text-right">
                                <div>{formatLL(item.total_price)}</div>
                                {item.quantity > 1 && (
                                  <div className="text-xs text-muted-foreground">
                                    {formatLL(item.unit_price)} each
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Financial Summary */}
                      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Subtotal</span>
                          <span className="text-right">
                            <div>{formatLL(transaction.subtotal)}</div>
                            <div className="text-xs text-muted-foreground">${formatUSD(convertLlToUsdForSale(transaction.subtotal))}</div>
                          </span>
                        </div>
                        <div className="flex justify-between text-sm font-semibold">
                          <span>Total</span>
                          <span className="text-right text-primary">
                            <div>{formatLL(transaction.total_amount)}</div>
                            <div className="text-xs text-muted-foreground">${formatUSD(convertLlToUsdForSale(transaction.total_amount))}</div>
                          </span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-sm">
                          <span>Amount Paid</span>
                          <span className="text-right">
                            <div>{formatLL(transaction.amount_paid)}</div>
                            <div className="text-xs text-muted-foreground">${formatUSD(convertLlToUsdForSale(transaction.amount_paid))}</div>
                          </span>
                        </div>
                        {transaction.calculated_change > 0 && (
                          <div className="flex justify-between text-sm text-green-600 font-medium">
                            <span>Change Returned</span>
                            <span className="text-right">
                              <div>{formatLL(transaction.calculated_change)}</div>
                              <div className="text-xs text-muted-foreground">${formatUSD(convertLlToUsdForReturn(transaction.calculated_change))}</div>
                            </span>
                          </div>
                        )}
                        <Separator />
                        <div className="text-xs text-muted-foreground text-center pt-1">
                          Sell rate: 1 USD = {SELL_RATE.toLocaleString()} LL • Return rate: 1 USD = {RETURN_RATE.toLocaleString()} LL
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => handleSendWhatsApp(transaction)}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Send to WhatsApp
                        </Button>
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}