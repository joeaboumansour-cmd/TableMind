"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Clock,
  Receipt,
  RefreshCw,
  Send,
  Search,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Phone,
  Filter,
  User,
} from "lucide-react";
import { formatLL, formatDateTime, formatRelativeTime, formatUSD } from "@/lib/utils/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/AuthContext";
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
  currency: string;
}

interface Transaction {
  id: string;
  transaction_number: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
  whatsapp_sent_to?: string;
  user_id?: string;
  user_name?: string;
  transaction_items: TransactionItem[];
}

interface TransactionWithChange extends Transaction {
  calculated_change: number;
}

type DateFilter = "all" | "hour" | "today" | "week" | "month" | "90days";

export default function TransactionHistoryPage() {
  const router = useRouter();
  const { user, logout: authLogout } = useAuth();

  // Redirect if no user
  useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [user, router]);

  const [transactions, setTransactions] = useState<TransactionWithChange[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<TransactionWithChange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  
  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const authData = localStorage.getItem("goldensquirrel_auth");
      if (!authData) {
        router.replace("/login");
        return;
      }
      
      const parsed = JSON.parse(authData);
      const store_id = parsed.store_id;
      if (!store_id) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/transactions", {
        headers: {
          "x-auth-data": authData,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }

      const data = await response.json();
      const transactionsWithChange = (data.transactions || []).map((t: Transaction) => ({
        ...t,
        calculated_change: t.amount_paid && t.total_amount ? t.amount_paid - t.total_amount : 0
      }));
      setTransactions(transactionsWithChange);
    } catch (err: any) {
      console.error("Error fetching transactions:", err);
      setError(err.message || "Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  }, [user, router]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Apply date filter and search
  useEffect(() => {
    let filtered = [...transactions];
    
    // Apply date filter
    const now = new Date();
    if (dateFilter !== "all") {
      const cutoff = new Date();
      switch (dateFilter) {
        case "hour":
          cutoff.setHours(now.getHours() - 1);
          break;
        case "today":
          cutoff.setHours(0, 0, 0, 0);
          break;
        case "week":
          cutoff.setDate(now.getDate() - 7);
          break;
        case "month":
          cutoff.setMonth(now.getMonth() - 1);
          break;
        case "90days":
          cutoff.setDate(now.getDate() - 90);
          break;
      }
      filtered = filtered.filter(t => new Date(t.created_at) >= cutoff);
    }
    
    // Apply search filter - by transaction #, phone number, or amount
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const numericQuery = parseFloat(searchQuery.replace(/[^0-9.]/g, ""));
      
       filtered = filtered.filter(t => {
        // Search by transaction number
        if (t.transaction_number.toLowerCase().includes(query)) return true;
        // Search by phone number - only match if there are actual digits in the search
        const digitsOnly = searchQuery.replace(/\D/g, "");
        if (t.whatsapp_sent_to && digitsOnly && t.whatsapp_sent_to.includes(digitsOnly)) return true;
        // Search by user name
        if (t.user_name && t.user_name.toLowerCase().includes(query)) return true;
        // Search by transaction amount
        if (!isNaN(numericQuery) && t.total_amount === numericQuery) return true;
        // Search by amount paid
        if (!isNaN(numericQuery) && t.amount_paid === numericQuery) return true;
        return false;
      });
    }
    
    setFilteredTransactions(filtered);
  }, [searchQuery, dateFilter, transactions]);

  const handleSendWhatsApp = async (transaction: TransactionWithChange) => {
    const phoneNumber = prompt("Enter WhatsApp number (8 digits, e.g., 70123456):");
    if (!phoneNumber) return;

    const cleanNumber = phoneNumber.replace(/\D/g, "");
    if (cleanNumber.length !== 8) {
      toast.error("Please enter a valid 8-digit Lebanese number");
      return;
    }

    // Save phone number to transaction
    try {
      const authData = localStorage.getItem("goldensquirrel_auth");
      const response = await fetch(`/api/transactions/${transaction.id}/whatsapp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-data": authData || "",
        },
        body: JSON.stringify({ phone: cleanNumber }),
      });

      if (response.ok) {
        setTransactions(prev => prev.map(t => 
          t.id === transaction.id 
            ? { ...t, whatsapp_sent_to: cleanNumber }
            : t
        ));
      }
    } catch (err) {
      console.error("Failed to save WhatsApp phone:", err);
    }

    let storeName = "TableMind Store";
    try {
      const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      if (authData.username) {
        storeName = authData.username;
      }
    } catch (e) {}

    const receiptLines: string[] = [];
    receiptLines.push(`*${storeName}*`);
    receiptLines.push(`Transaction: #${transaction.transaction_number}`);
    receiptLines.push(`Date: ${formatDateTime(transaction.created_at)}`);
    receiptLines.push("");
    receiptLines.push("*Items:*");
    transaction.transaction_items.forEach((item) => {
      receiptLines.push(`${item.product_name} x${item.quantity} - ${formatLL(item.total_price)}`);
    });
    receiptLines.push("");
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

  if (isLoading || !user) {
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
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-bold text-lg">Transaction History</h1>
                <p className="text-sm text-muted-foreground">
                 {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchTransactions} disabled={isLoading} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          
          {/* Search Bar - search by transaction #, phone, or amount */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by #, phone, or amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {/* Date Filters */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            <Filter className="h-4 w-4 text-muted-foreground mr-1" />
            {(["all", "hour", "today", "week", "month", "90days"] as DateFilter[]).map((filter) => (
              <Button
                key={filter}
                variant={dateFilter === filter ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter(filter)}
                className="text-xs"
              >
                {filter === "all" ? "All" : 
                 filter === "hour" ? "1h" : 
                 filter === "today" ? "Today" : 
                 filter === "week" ? "7d" : 
                 filter === "month" ? "30d" : "90d"}
              </Button>
            ))}
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

        {filteredTransactions.length === 0 && !error ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-2">No Transactions Found</h3>
              <p className="text-muted-foreground text-center mb-4">
                {searchQuery || dateFilter !== "all" ? "No matching transactions found." : "No transactions found."}
              </p>
              {!searchQuery && dateFilter === "all" && (
                <Button onClick={() => router.push("/pos")}>Start New Transaction</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredTransactions.map((transaction) => (
              <Collapsible
                key={transaction.id}
                open={openAccordion === transaction.id}
                onOpenChange={() => toggleAccordion(transaction.id)}
              >
                <Card className={`transition-all ${openAccordion === transaction.id ? "ring-2 ring-primary" : ""}`}>
                  <CollapsibleTrigger asChild>
                    <div className="cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">#{transaction.transaction_number}</span>
                              <Badge variant="secondary" className="text-xs">
                                {transaction.transaction_items.length} item{transaction.transaction_items.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatRelativeTime(transaction.created_at)}</span>
                              <span>&bull;</span>
                              <span>{formatDateTime(transaction.created_at)}</span>
                            </div>
                            {transaction.whatsapp_sent_to && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-green-600">
                                <Phone className="h-3 w-3" />
                                <span>Sent to: {transaction.whatsapp_sent_to}</span>
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-primary">{formatLL(transaction.total_amount)}</div>
                            {transaction.calculated_change > 0 && (
                              <div className="text-xs text-green-600">Change: {formatLL(transaction.calculated_change)}</div>
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

                  <CollapsibleContent>
                    <Separator />
                    <CardContent className="p-4 space-y-4">
                      <div>
                        <h4 className="font-medium text-sm mb-2">Line Items</h4>
                        <div className="space-y-2">
                          {transaction.transaction_items.map((item) => (
                            <div key={item.id} className="flex justify-between text-sm py-2 border-b border-border/50 last:border-0">
                              <div className="flex-1">
                                <span className="font-medium">{item.product_name}</span>
                                <span className="text-muted-foreground ml-2">&times;{item.quantity}</span>
                              </div>
                              <div className="text-right">
                                {item.currency === 'LL' ? (
                                  <>
                                    <div>{formatLL(item.total_price)}</div>
                                    {item.quantity > 1 && <div className="text-xs text-muted-foreground">{formatLL(item.unit_price)} each</div>}
                                  </>
                                ) : (
                                  <>
                                    <div>{formatUSD(item.total_price)}</div>
                                    {item.quantity > 1 && <div className="text-xs text-muted-foreground">{formatUSD(item.unit_price)} each</div>}
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Subtotal</span>
                          <span className="text-right">{formatLL(transaction.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-semibold">
                          <span>Total</span>
                          <span className="text-right text-primary">{formatLL(transaction.total_amount)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-sm">
                          <span>Amount Paid</span>
                          <span className="text-right">{formatLL(transaction.amount_paid)}</span>
                        </div>
                        {transaction.calculated_change > 0 && (
                          <div className="flex justify-between text-sm text-green-600 font-medium">
                            <span>Change Returned</span>
                            <span className="text-right">{formatLL(transaction.calculated_change)}</span>
                          </div>
                        )}
                      </div>

                       <div className="flex flex-col gap-2">
                         {transaction.whatsapp_sent_to ? (
                           <div className="flex-1 flex items-center justify-center text-sm text-green-600 font-medium">
                             <Send className="h-4 w-4 mr-2" />
                             Sent to: {transaction.whatsapp_sent_to}
                           </div>
                         ) : (
                           <Button variant="outline" className="flex-1" onClick={() => handleSendWhatsApp(transaction)}>
                             <Send className="h-4 w-4 mr-2" />
                             Send to WhatsApp
                           </Button>
                         )}
                         {transaction.user_name && (
                           <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                             <User className="h-3 w-3 mr-1" />
                             By: {transaction.user_name}
                           </div>
                         )}
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