"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Printer,
  Share2,
  Download,
  Loader2,
  RefreshCw,
  Phone,
  MapPin,
  MessageCircle,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { formatLL, formatDateTime } from "@/lib/utils/format";
import { isValidReceiptToken } from "@/lib/receipt/token";

interface PublicReceiptItem {
  product_name: string;
  quantity: number;
}

interface PublicReceipt {
  transaction_number: string;
  created_at: string;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  items: PublicReceiptItem[];
  store: {
    name: string;
    phone_whatsapp: string | null;
    address: string | null;
  };
}

export default function PublicReceiptPage() {
  const params = useParams();
  const token = params.id as string;

  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReceipt = useCallback(async () => {
    if (!isValidReceiptToken(token)) {
      setError("This receipt link is invalid.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/public/receipt/${token}`);
      if (response.status === 404) {
        const data = await response.json();
        if (data.pending) {
          // Transaction not synced yet (store was offline at checkout)
          setIsPending(true);
          setError(null);
          setReceipt(null);
        } else {
          setError("This receipt could not be found.");
          setIsPending(false);
        }
        return;
      }
      if (response.status === 429) {
        setError("Too many requests. Please try again later.");
        setIsPending(false);
        return;
      }
      if (!response.ok) {
        setError("Failed to load receipt. Please try again.");
        setIsPending(false);
        return;
      }

      const data = await response.json();
      setReceipt(data.receipt);
      setIsPending(false);
      setError(null);
    } catch (err) {
      console.error("Error fetching receipt:", err);
      setError("Failed to load receipt. Please check your connection.");
      setIsPending(false);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  // Auto-retry while the transaction is pending sync (store was offline)
  useEffect(() => {
    if (!isPending) return;
    const interval = setInterval(() => {
      fetchReceipt();
    }, 5000);
    return () => clearInterval(interval);
  }, [isPending, fetchReceipt]);

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Receipt - ${receipt?.transaction_number || ""}`,
          text: `Your receipt from ${receipt?.store?.name || "our store"}`,
          url,
        });
      } catch (err) {
        // User cancelled share
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      } catch (err) {
        toast.error("Failed to copy link");
      }
    }
  };

  const handleDownload = async () => {
    if (!receipt) return;
    try {
      // Use html2pdf.js (already a dependency) to generate a PDF of the receipt
      const { default: html2pdf } = await import("html2pdf.js");
      const element = document.getElementById("receipt-print-area");
      if (!element) return;

      const opt = {
        margin: 10,
        filename: `receipt-${receipt.transaction_number}.pdf`,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm" as const, format: "a5" as const, orientation: "portrait" as const },
      };

      await html2pdf().set(opt).from(element).save();
      toast.success("Receipt downloaded as PDF");
    } catch (err) {
      console.error("Failed to download PDF:", err);
      toast.error("Failed to download PDF. Try Print instead.");
    }
  };

  // Build WhatsApp link from store phone (free marketing on the e-receipt)
  const whatsappLink = receipt?.store.phone_whatsapp
    ? `https://wa.me/${receipt.store.phone_whatsapp.replace(/\D/g, "")}`
    : null;

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

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <RefreshCw className="h-8 w-8 text-amber-500 animate-spin" />
            </div>
            <h2 className="text-xl font-bold mb-2">Receipt Pending</h2>
            <p className="text-muted-foreground mb-4">
              This receipt was created while the store was offline. It will appear
              here automatically once the store reconnects.
            </p>
            <Button variant="outline" onClick={fetchReceipt}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Check Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Receipt className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold mb-2">Receipt Not Found</h2>
            <p className="text-muted-foreground mb-4">
              {error || "This receipt could not be found."}
            </p>
            <Button variant="outline" onClick={fetchReceipt}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b print:hidden">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-lg">{receipt.store.name}</h1>
              <p className="text-sm text-muted-foreground">
                Digital Receipt
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                PDF
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
            <CardContent className="pt-6" id="receipt-print-area">
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
                <h2 className="text-xl font-bold">{receipt.store.name}</h2>
                <p className="text-sm text-muted-foreground">Digital Receipt</p>
              </div>

              {/* Store Contact Info — free marketing */}
              {(receipt.store.phone_whatsapp || receipt.store.address) && (
                <div className="space-y-1.5 text-sm mb-6 p-3 bg-muted/50 rounded-lg">
                  {receipt.store.phone_whatsapp && (
                    <div className="flex items-center justify-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{receipt.store.phone_whatsapp}</span>
                      {whatsappLink && (
                        <a
                          href={whatsappLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-green-600 hover:underline"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                  {receipt.store.address && (
                    <div className="flex items-center justify-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{receipt.store.address}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Transaction Info */}
              <div className="space-y-2 text-sm mb-6">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transaction #</span>
                  <span className="font-mono">{receipt.transaction_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span>{formatDateTime(receipt.created_at)}</span>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Items — name + quantity only, NO unit prices */}
              <div className="space-y-3 mb-6">
                {receipt.items.map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{item.product_name}</p>
                    </div>
                    <span className="text-muted-foreground shrink-0 ml-4">
                      × {item.quantity}
                    </span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              {/* Totals */}
              <div className="space-y-2">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span className="text-amber-500">{formatLL(receipt.total_amount)}</span>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Payment Info */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span>{formatLL(receipt.amount_paid)}</span>
                </div>
                {receipt.change_given > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Change</span>
                    <span>{formatLL(receipt.change_given)}</span>
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
        </div>
      </div>
    </div>
  );
}