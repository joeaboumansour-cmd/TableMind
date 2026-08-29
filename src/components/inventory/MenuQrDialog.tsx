"use client";

// =============================================
// Menu & QR code
// =============================================
// Where a shop gets the thing it sticks on a table. Publish, copy the link,
// print a table tent, or share it.
//
// The QR encodes an opaque token URL, never the store id — see migration 035.
// =============================================

import { useCallback, useEffect, useState } from "react";
import { Copy, Printer, QrCode, RefreshCw, Share2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { menuUrl } from "@/lib/menu/types";

interface MenuQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown on the printed tent so a customer knows whose menu it is. */
  storeName: string;
}

export default function MenuQrDialog({
  open,
  onOpenChange,
  storeName,
}: MenuQrDialogProps) {
  const [token, setToken] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const url = token && typeof window !== "undefined" ? menuUrl(window.location.origin, token) : "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/menu-link", { headers: buildAuthHeaders() });
        if (!response.ok) throw new Error(`API error ${response.status}`);
        const body = (await response.json()) as { token: string | null; published: boolean };
        if (cancelled) return;
        setToken(body.token);
        setPublished(body.published);
      } catch {
        if (!cancelled) toast.error("Could not load the menu link");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Rendered in the browser rather than fetched, so the code exists even on a
  // shop's poor connection and never depends on a third-party image service.
  useEffect(() => {
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 720,
          margin: 1,
          errorCorrectionLevel: "M",
          // Pure black on white. A themed QR looks smart and scans badly, and
          // this one gets printed and read across a counter in poor light.
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const act = useCallback(
    async (action: "publish" | "unpublish" | "rotate") => {
      setBusy(true);
      try {
        const response = await fetch("/api/menu-link", {
          method: "POST",
          headers: buildAuthHeaders(),
          body: JSON.stringify({ action }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `API error ${response.status}`);
        }
        const body = (await response.json()) as { token: string | null; published: boolean };
        setToken(body.token);
        setPublished(body.published);
        toast.success(
          action === "unpublish"
            ? "Menu taken down. Printed codes will work again when you publish."
            : action === "rotate"
              ? "New code created. Printed copies of the old one no longer work."
              : "Menu is live"
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the menu");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy — long-press the link instead");
    }
  };

  const share = async () => {
    // Web Share puts it straight into WhatsApp, which is how a Lebanese shop
    // actually sends this. Falls back to copying where it is unavailable.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `${storeName} menu`, url });
        return;
      } catch {
        return; // the user dismissed the sheet; not an error
      }
    }
    void copy();
  };

  /**
   * Print just the tent, not the app around it.
   *
   * Writes a standalone document into a new window rather than fighting the
   * app's forced-dark theme with print CSS — a menu tent must come out black
   * on white, and the app's palette would print a grey slab.
   */
  const print = () => {
    if (!qrDataUrl || !url) return;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) {
      toast.error("Allow pop-ups to print the menu code");
      return;
    }
    const safeName = storeName.replace(/[<>&]/g, "");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>${safeName} — menu</title>
<style>
  @page { margin: 16mm; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff;
         display: flex; flex-direction: column; align-items: center; justify-content: center;
         min-height: 90vh; text-align: center; margin: 0; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  p  { font-size: 15px; color: #444; margin: 0 0 24px; }
  img { width: 320px; height: 320px; }
  code { font-size: 11px; color: #666; word-break: break-all; display: block;
         margin-top: 16px; max-width: 340px; }
</style></head><body>
<h1>${safeName}</h1>
<p>Scan for our menu</p>
<img src="${qrDataUrl}" alt="Menu QR code">
<code>${url}</code>
</body></html>`);
    w.document.close();
    w.focus();
    // Give the image a tick to decode; printing a blank frame is the classic
    // failure here.
    setTimeout(() => w.print(), 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Menu &amp; QR code</DialogTitle>
          <DialogDescription>
            A public page built from your inventory. It updates itself whenever
            you change a price or add an item.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {published ? "Menu is live" : "Menu is off"}
            </p>
            <p className="text-xs text-muted-foreground">
              {published
                ? "Anyone with the code can see your items and prices."
                : "Turn on to publish your menu."}
            </p>
          </div>
          <Switch
            checked={published}
            disabled={busy || !loaded}
            onCheckedChange={(next: boolean) => void act(next ? "publish" : "unpublish")}
          />
        </div>

        {published && url && (
          <>
            <div className="flex justify-center rounded-2xl bg-white p-5">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="QR code for the public menu"
                  className="h-56 w-56"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center text-sm text-zinc-500">
                  <QrCode className="h-8 w-8" />
                </div>
              )}
            </div>

            <p className="break-all rounded-lg bg-muted/50 p-2 text-center text-xs text-muted-foreground">
              {url}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()}>
                <Copy className="h-4 w-4" />
                Copy link
              </Button>
              <Button type="button" variant="outline" onClick={() => void share()}>
                <Share2 className="h-4 w-4" />
                Share
              </Button>
              <Button type="button" variant="outline" onClick={print} disabled={!qrDataUrl}>
                <Printer className="h-4 w-4" />
                Print tent
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(url, "_blank", "noopener")}
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </Button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void act("rotate")}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Create a new code — printed copies of the old one stop working
            </button>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
