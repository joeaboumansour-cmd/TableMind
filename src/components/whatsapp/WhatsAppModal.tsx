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
import { MessageCircle, Send, Loader2, CheckCircle } from "lucide-react";
import { DEFAULT_TEMPLATES, WhatsAppTemplate } from "@/lib/whatsapp/types";
import { toast } from "sonner";

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  phoneNumber: string;
  customerName: string;
  customerId: string;
  restaurantName: string;
  reservationDetails?: {
    date?: string;
    time?: string;
    partySize?: number;
  };
}

export function WhatsAppModal({
  isOpen,
  onClose,
  phoneNumber,
  customerName,
  customerId,
  restaurantName,
  reservationDetails,
}: WhatsAppModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [customMessage, setCustomMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [activeTab, setActiveTab] = useState("templates");

  const templates = DEFAULT_TEMPLATES;

  const getTemplatePreview = (template: WhatsAppTemplate): string => {
    let preview = template.content;
    
    // Replace variables with sample values
    const sampleValues: Record<string, string> = {
      customer_name: customerName,
      restaurant_name: restaurantName,
      date: reservationDetails?.date || "Saturday, Feb 22",
      time: reservationDetails?.time || "7:00 PM",
      party_size: String(reservationDetails?.partySize || "4"),
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
    setIsSending(true);

    try {
      const template = templates.find((t) => t.id === selectedTemplate);
      const message =
        activeTab === "templates" && template
          ? getTemplatePreview(template)
          : customMessage;

      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          message,
          templateName: template?.name,
          customerId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setIsSent(true);
      toast.success("WhatsApp message sent successfully!");

      // Reset after 2 seconds and close
      setTimeout(() => {
        setIsSent(false);
        setSelectedTemplate("");
        setCustomMessage("");
        onClose();
      }, 2000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send message"
      );
    } finally {
      setIsSending(false);
    }
  };

  const getSelectedTemplateContent = () => {
    const template = templates.find((t) => t.id === selectedTemplate);
    return template ? getTemplatePreview(template) : "";
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
            Send WhatsApp Message
          </DialogTitle>
          <DialogDescription>
            Send a message to {customerName} at {phoneNumber}
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Message Sent!</h3>
            <p className="text-muted-foreground">
              Your WhatsApp message has been sent successfully.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
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
                      {templates.map((template) => (
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
                    <Label>Preview</Label>
                    <div className="p-4 bg-[#DCF8C6] rounded-lg text-sm">
                      {getSelectedTemplateContent()}
                    </div>
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
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
