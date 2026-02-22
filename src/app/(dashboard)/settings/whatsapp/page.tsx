"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  MessageCircle, 
  CheckCircle, 
  AlertCircle, 
  Copy, 
  ExternalLink,
  RefreshCw,
  Send,
  Loader2,
  Info,
  Phone,
  Key,
  Building
} from "lucide-react";
import { toast } from "sonner";

interface WhatsAppSettings {
  provider: string;
  isConfigured: boolean;
  phoneNumberId?: string;
  businessAccountId?: string;
  hasApiKey: boolean;
}

export default function WhatsAppSettingsPage() {
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [activeTab, setActiveTab] = useState("setup");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/whatsapp/status");
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      toast.error("Failed to load WhatsApp settings");
    } finally {
      setIsLoading(false);
    }
  };

  const testConnection = async () => {
    if (!testPhone) {
      toast.error("Please enter a phone number");
      return;
    }

    setIsTesting(true);
    try {
      const response = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Test message sent successfully!");
      } else {
        toast.error(data.error || "Failed to send test message");
      }
    } catch (error) {
      toast.error("Failed to send test message");
    } finally {
      setIsTesting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WhatsApp Settings</h1>
          <p className="text-muted-foreground">
            Configure Meta WhatsApp Business API for bulk messaging
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-[#25D366]" />
          <Badge variant={settings?.isConfigured ? "default" : "destructive"}>
            {settings?.isConfigured ? "Configured" : "Not Configured"}
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="setup">Setup Guide</TabsTrigger>
          <TabsTrigger value="templates">Message Templates</TabsTrigger>
          <TabsTrigger value="test">Test Connection</TabsTrigger>
        </TabsList>

        {/* Setup Guide */}
        <TabsContent value="setup" className="space-y-4">
          {!settings?.isConfigured && (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle>WhatsApp Not Configured</AlertTitle>
              <AlertDescription>
                Follow the steps below to set up Meta WhatsApp Business API for bulk messaging.
              </AlertDescription>
            </Alert>
          )}

          {settings?.isConfigured && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle>WhatsApp is Configured</AlertTitle>
              <AlertDescription>
                Your WhatsApp Business API is ready to use. You can send up to 1,000 conversations per month for free.
              </AlertDescription>
            </Alert>
          )}

          {/* Step 1: Meta Business Account */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                  1
                </div>
                <div>
                  <CardTitle>Create Meta Business Account</CardTitle>
                  <CardDescription>Set up your business presence on Meta</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Go to <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">business.facebook.com <ExternalLink className="h-3 w-3" /></a></li>
                <li>Create or log in to your Business Manager account</li>
                <li>Complete business verification (required for production)</li>
              </ol>
            </CardContent>
          </Card>

          {/* Step 2: WhatsApp Business Platform */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                  2
                </div>
                <div>
                  <CardTitle>Set Up WhatsApp Business Platform</CardTitle>
                  <CardDescription>Enable WhatsApp Business API</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>In Business Manager, go to <strong>Meta Business Suite</strong> → <strong>WhatsApp Manager</strong></li>
                <li>Click <strong>Get Started</strong> with WhatsApp Business Platform</li>
                <li>Create a new WhatsApp Business Account</li>
                <li>Add a phone number and verify it via SMS/call</li>
              </ol>
              <Alert className="bg-blue-50 border-blue-200">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm">
                  Use a phone number not already on WhatsApp. You can use a new SIM card or a virtual number service.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Step 3: Get Credentials */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                  3
                </div>
                <div>
                  <CardTitle>Get API Credentials</CardTitle>
                  <CardDescription>Generate access token and get IDs</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Create System User & Token:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>In Business Manager, go to <strong>Settings</strong> → <strong>System Users</strong></li>
                    <li>Create a new System User with <strong>Admin</strong> role</li>
                    <li>Click <strong>Generate Token</strong></li>
                    <li>Select your WhatsApp Business App</li>
                    <li>Grant permissions: <code>whatsapp_business_messaging</code>, <code>whatsapp_business_management</code></li>
                    <li>Copy the generated token (you won't see it again!)</li>
                  </ol>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Get Phone Number ID:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>In WhatsApp Manager, select your phone number</li>
                    <li>The Phone Number ID is shown in the settings</li>
                    <li>Also note your Business Account ID from the URL</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 4: Configure Environment */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                  4
                </div>
                <div>
                  <CardTitle>Configure TableMind</CardTitle>
                  <CardDescription>Add credentials to environment variables</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Add these environment variables to your <code>.env.local</code> file:
              </p>
              
              <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span>WHATSAPP_PROVIDER=meta</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard("WHATSAPP_PROVIDER=meta")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">META_WHATSAPP_API_KEY=your_token_here</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard("META_WHATSAPP_API_KEY=")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">META_WHATSAPP_PHONE_NUMBER_ID=your_phone_id</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard("META_WHATSAPP_PHONE_NUMBER_ID=")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">META_WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_id</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard("META_WHATSAPP_BUSINESS_ACCOUNT_ID=")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Alert className="bg-amber-50 border-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm">
                  Restart your Next.js server after adding these variables.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Message Templates */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Message Templates</CardTitle>
              <CardDescription>
                Meta requires pre-approved templates for outbound messages. You need to create these in Meta Business Manager.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-blue-50 border-blue-200">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertTitle>Why Templates?</AlertTitle>
                <AlertDescription>
                  WhatsApp Business API requires message templates for any message sent outside the 24-hour conversation window. Templates must be approved by Meta (usually takes 24-48 hours).
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <h4 className="font-medium">Default Templates to Create:</h4>
                
                <div className="grid gap-4">
                  {[
                    {
                      name: "reservation_confirmation",
                      desc: "Sent when a new reservation is created",
                      vars: ["customer_name", "restaurant_name", "date", "time", "party_size"],
                      content: "Hi {{1}}! Your reservation at {{2}} is confirmed for {{3}} at {{4}} for {{5}} guests. We look forward to seeing you!"
                    },
                    {
                      name: "reservation_reminder",
                      desc: "Reminder sent before reservation",
                      vars: ["customer_name", "restaurant_name", "time", "party_size"],
                      content: "Hi {{1}}! Reminder: You have a reservation at {{2}} at {{3}} for {{4}} guests. Reply CONFIRM to confirm or CANCEL to cancel."
                    },
                    {
                      name: "table_ready",
                      desc: "Sent when table is ready",
                      vars: ["customer_name", "restaurant_name"],
                      content: "Hi {{1}}! Your table at {{2}} is ready! Please check in with the host within 10 minutes."
                    },
                    {
                      name: "special_offer",
                      desc: "Marketing message for promotions",
                      vars: ["customer_name", "restaurant_name", "offer_details", "expiry_date"],
                      content: "Hi {{1}}! {{2}} has a special offer for you: {{3}}. Valid until {{4}}. Book now!"
                    },
                    {
                      name: "birthday_wish",
                      desc: "Birthday greeting with offer",
                      vars: ["customer_name", "restaurant_name"],
                      content: "🎉 Happy Birthday {{1}}! Wishing you a wonderful day from all of us at {{2}}. Show this message for a complimentary dessert!"
                    }
                  ].map((template) => (
                    <Card key={template.name} className="border-l-4 border-l-[#25D366]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base font-mono">{template.name}</CardTitle>
                        <CardDescription>{template.desc}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-sm text-muted-foreground">Variables: {template.vars.map(v => `{{${v}}}`).join(", ")}</p>
                        <div className="bg-muted p-3 rounded text-sm">
                          {template.content}
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => copyToClipboard(template.content)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Template
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">How to Create Templates:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Go to <strong>Meta Business Suite</strong> → <strong>WhatsApp Manager</strong></li>
                  <li>Click <strong>Account tools</strong> → <strong>Message templates</strong></li>
                  <li>Click <strong>Create template</strong></li>
                  <li>Choose category: <strong>Marketing</strong> or <strong>Utility</strong></li>
                  <li>Name your template (use lowercase with underscores)</li>
                  <li>Add content using <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> for variables</li>
                  <li>Submit for approval</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Connection */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test WhatsApp Connection</CardTitle>
              <CardDescription>
                Send a test message to verify your setup
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings?.isConfigured ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="test-phone">Phone Number (with country code)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="test-phone"
                        placeholder="+1234567890"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                      />
                      <Button 
                        onClick={testConnection}
                        disabled={isTesting}
                        className="bg-[#25D366] hover:bg-[#128C7E]"
                      >
                        {isTesting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-2" />
                            Send Test
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Include country code (e.g., +961 for Lebanon, +1 for USA)
                    </p>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription>
                      The test will use your configured Meta WhatsApp Business API. Make sure you have a 24-hour conversation window open or use an approved template.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>WhatsApp Not Configured</AlertTitle>
                  <AlertDescription>
                    Please complete the setup steps before testing. Add your Meta API credentials to the environment variables.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {settings?.isConfigured && (
            <Card>
              <CardHeader>
                <CardTitle>Current Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Provider</span>
                    </div>
                    <Badge variant="outline">{settings.provider}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Phone Number ID</span>
                    </div>
                    <Badge variant="outline">
                      {settings.phoneNumberId ? "Configured" : "Missing"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Business Account ID</span>
                    </div>
                    <Badge variant="outline">
                      {settings.businessAccountId ? "Configured" : "Missing"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">API Key</span>
                    </div>
                    <Badge variant={settings.hasApiKey ? "default" : "destructive"}>
                      {settings.hasApiKey ? "Configured" : "Missing"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="outline" onClick={fetchSettings} className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Status
                </Button>
              </CardFooter>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Pricing Info */}
      <Card className="bg-gradient-to-r from-[#25D366]/10 to-[#128C7E]/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
            WhatsApp Business API Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-background rounded-lg">
              <p className="text-2xl font-bold text-[#25D366]">1,000</p>
              <p className="text-sm text-muted-foreground">Free conversations/month</p>
            </div>
            <div className="p-4 bg-background rounded-lg">
              <p className="text-2xl font-bold">$0.005-0.08</p>
              <p className="text-sm text-muted-foreground">Per conversation after free tier</p>
            </div>
            <div className="p-4 bg-background rounded-lg">
              <p className="text-2xl font-bold">24h</p>
              <p className="text-sm text-muted-foreground">Conversation window</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            A conversation is a 24-hour messaging session. User-initiated conversations are free. 
            Business-initiated conversations use templates and count toward your limit.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
