"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  MessageCircle, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2,
  ExternalLink,
  RefreshCcw,
  Send
} from "lucide-react";
import { toast } from "sonner";

interface WhatsAppStatus {
  provider: string;
  configured: boolean;
  envVars: { [key: string]: boolean };
  missingVars: string[];
}

const PROVIDER_LABELS: Record<string, { name: string; description: string; docs: string }> = {
  mock: {
    name: "Mock (Development)",
    description: "Messages are logged to console only, not sent",
    docs: "#",
  },
  twilio: {
    name: "Twilio",
    description: "Send real WhatsApp messages using Twilio's API",
    docs: "https://www.twilio.com/docs/whatsapp",
  },
  meta: {
    name: "Meta WhatsApp Business API",
    description: "Official WhatsApp Business API through Meta",
    docs: "https://developers.facebook.com/docs/whatsapp",
  },
  "360dialog": {
    name: "360dialog",
    description: "WhatsApp Business API through 360dialog",
    docs: "https://docs.360dialog.com/",
  },
};

const ENV_VAR_LABELS: Record<string, string> = {
  accountSid: "Account SID",
  authToken: "Auth Token",
  phoneNumber: "WhatsApp Phone Number",
  apiKey: "API Key / Access Token",
  phoneNumberId: "Phone Number ID",
  businessAccountId: "Business Account ID",
};

export default function WhatsAppSettingsPage() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/whatsapp/status");
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      toast.error("Failed to fetch WhatsApp status");
    } finally {
      setLoading(false);
    }
  };

  const sendTestMessage = async () => {
    if (!testPhone.trim()) {
      toast.error("Please enter a phone number");
      return;
    }

    setSendingTest(true);
    try {
      const response = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send test message");
      }

      toast.success(`Test message sent! Message ID: ${data.messageId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test message");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const providerInfo = status ? PROVIDER_LABELS[status.provider] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">WhatsApp Settings</h1>
        <p className="text-muted-foreground">
          Configure your WhatsApp messaging provider and test your integration
        </p>
      </div>

      <Separator />

      {/* Current Provider Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#25D366]/10 rounded-lg">
                <MessageCircle className="h-6 w-6 text-[#25D366]" />
              </div>
              <div>
                <CardTitle>Current Provider</CardTitle>
                <CardDescription>{providerInfo?.description}</CardDescription>
              </div>
            </div>
            <Badge variant={status?.configured ? "default" : "destructive"}>
              {status?.configured ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Configured
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  Not Configured
                </>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <p className="font-medium">{providerInfo?.name}</p>
              <p className="text-sm text-muted-foreground">
                Provider: <code className="bg-background px-1 rounded">{status?.provider}</code>
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={providerInfo?.docs} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Documentation
              </a>
            </Button>
          </div>

          {/* Environment Variables Status */}
          {status && Object.keys(status.envVars).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Environment Variables</h4>
              <div className="grid gap-2">
                {Object.entries(status.envVars).map(([key, isSet]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded"
                  >
                    <span className="text-sm">{ENV_VAR_LABELS[key] || key}</span>
                    {isSet ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing Variables Warning */}
          {status && status.missingVars.length > 0 && (
            <div className="flex items-start gap-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">Missing Environment Variables</p>
                <p className="text-sm text-yellow-700">
                  The following environment variables need to be set in your{" "}
                  <code className="bg-yellow-100 px-1 rounded">.env.local</code> file:
                </p>
                <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                  {status.missingVars.map((varName) => (
                    <li key={varName}>
                      <code className="bg-yellow-100 px-1 rounded">{varName}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Setup Guide Link */}
          <div className="flex items-center gap-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-blue-600" />
            <div className="flex-1">
              <p className="font-medium text-blue-800">Need help setting up?</p>
              <p className="text-sm text-blue-700">
                Check out the detailed setup guide for step-by-step instructions.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/docs/WHATSAPP_SETUP.md" target="_blank">
                View Guide
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Test Message Section */}
      <Card>
        <CardHeader>
          <CardTitle>Send Test Message</CardTitle>
          <CardDescription>
            Test your WhatsApp configuration by sending a message to your phone
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="test-phone">Phone Number</Label>
              <Input
                id="test-phone"
                placeholder="+1234567890 (include country code)"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={sendTestMessage}
            disabled={sendingTest || !status?.configured}
            className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white"
          >
            {sendingTest ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Test Message
              </>
            )}
          </Button>
          {!status?.configured && (
            <p className="text-sm text-muted-foreground text-center">
              Configure your provider first to send test messages
            </p>
          )}
        </CardContent>
      </Card>

      {/* Message Templates Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Available Message Templates</CardTitle>
          <CardDescription>
            Pre-built templates for common restaurant scenarios
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { name: "Reservation Confirmation", category: "Reservation" },
              { name: "24-Hour Reminder", category: "Reminder" },
              { name: "2-Hour Reminder", category: "Reminder" },
              { name: "Table Ready - Waitlist", category: "Reservation" },
              { name: "Birthday Wish", category: "Marketing" },
              { name: "Special Offer", category: "Marketing" },
              { name: "We Miss You", category: "Marketing" },
              { name: "Custom Message", category: "Custom" },
            ].map((template) => (
              <div
                key={template.name}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div>
                  <p className="font-medium text-sm">{template.name}</p>
                  <Badge variant="secondary" className="text-xs">
                    {template.category}
                  </Badge>
                </div>
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={fetchStatus}>
          <RefreshCcw className="h-4 w-4 mr-2" />
          Refresh Status
        </Button>
      </div>
    </div>
  );
}
