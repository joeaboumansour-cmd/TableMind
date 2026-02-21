"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Send, Loader2, Users, CheckCircle } from "lucide-react";
import { DEFAULT_TEMPLATES, WhatsAppTemplate } from "@/lib/whatsapp/types";
import { toast } from "sonner";

interface Customer {
  id: string;
  name: string;
  phone: string;
}

interface BulkWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  restaurantName: string;
}

export function BulkWhatsAppModal({
  isOpen,
  onClose,
  customers,
  restaurantName,
}: BulkWhatsAppModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [customMessage, setCustomMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [sendResults, setSendResults] = useState<{
    total: number;
    successful: number;
    failed: number;
  } | null>(null);
  const [activeTab, setActiveTab] = useState("templates");

  const templates = DEFAULT_TEMPLATES;

  const getTemplatePreview = (template: WhatsAppTemplate): string => {
    let preview = template.content;
    
    // Replace variables with sample values
    const sampleValues: Record<string, string> = {
      customer_name: "[Customer Name]",
      restaurant_name: restaurantName,
      date: "Saturday, Feb 22",
      time: "7:00 PM",
      party_size: "4",
      offer_details: "20% off your next visit",
      expiry_date: "March 31, 2026",
      message: customMessage,
    };

    Object.entries(sampleValues).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(`{{${key}}}`, "g"), value);
    });

    return preview;
  };

  const handleSend = async () => {
    if (customers.length === 0) {
      toast.error("No customers selected");
      return;
    }

    setIsSending(true);

    try {
      const template = templates.find((t) => t.id === selectedTemplate);
      
      // Prepare messages for each customer
      const messages = customers.map((customer) => {
        let message =
          activeTab === "templates" && template
            ? template.content
            : customMessage;

        // Replace variables for each customer
        const values: Record<string, string> = {
          customer_name: customer.name,
          restaurant_name: restaurantName,
          date: "Saturday, Feb 22",
          time: "7:00 PM",
          party_size: "4",
          offer_details: "20% off your next visit",
          expiry_date: "March 31, 2026",
          message: customMessage,
        };

        Object.entries(values).forEach(([key, value]) => {
          message = message.replace(new RegExp(`{{${key}}}`, "g"), value);
        });

        return {
          to: customer.phone,
          message,
          customerId: customer.id,
        };
      });

      const response = await fetch("/api/whatsapp/send-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          templateName: template?.name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send messages");
      }

      setSendResults(data.summary);
      setIsSent(true);
      toast.success(`Messages sent! ${data.summary.successful} successful, ${data.summary.failed} failed`);

      // Reset after 3 seconds
      setTimeout(() => {
        setIsSent(false);
        setSelectedTemplate("");
        setCustomMessage("");
        setSendResults(null);
        onClose();
      }, 3000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send messages"
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
            Bulk WhatsApp Campaign
          </DialogTitle>
          <DialogDescription>
            Send WhatsApp messages to {customers.length} selected customers
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Campaign Sent!</h3>
            {sendResults && (
              <div className="mt-4 grid grid-cols-3 gap-4">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold">{sendResults.total}</p>
                  <p className="text-sm text-muted-foreground">Total</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">{sendResults.successful}</p>
                  <p className="text-sm text-muted-foreground">Sent</p>
                </div>
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-2xl font-bold text-red-600">{sendResults.failed}</p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Selected Customers Preview */}
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Users className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{customers.length} customers selected</span>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="templates">Templates</TabsTrigger>
                <TabsTrigger value="custom">Custom Message</TabsTrigger>
              </TabsList>

              <TabsContent value="templates" className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Template</Label>
                  <Select
                    value={selectedTemplate}
                    onValueChange={setSelectedTemplate}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templates
                        .filter((t) => t.category === "marketing" || t.category === "custom")
                        .map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            <div className="flex flex-col items-start">
                              <span className="font-medium">{template.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {template.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTemplate && (
                  <div className="space-y-2">
                    <Label>Preview (with variables)</Label>
                    <div className="p-4 bg-[#DCF8C6] rounded-lg text-sm">
                      {getTemplatePreview(
                        templates.find((t) => t.id === selectedTemplate)!
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Variables like {"{{customer_name}}"} will be replaced with each customer's actual name
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="custom" className="space-y-4">
                <div className="space-y-2">
                  <Label>Your Message</Label>
                  <Textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder="Type your message here..."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{{customer_name}}"} to include the customer's name
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <Button
              onClick={handleSend}
              disabled={
                isSending ||
                (activeTab === "templates" && !selectedTemplate) ||
                (activeTab === "custom" && !customMessage.trim())
              }
              className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white"
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending to {customers.length} customers...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send to {customers.length} Customers
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
