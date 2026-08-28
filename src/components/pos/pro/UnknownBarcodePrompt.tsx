"use client";

// =============================================
// Unknown barcode capture (desktop Pro till)
//
// Before this, scanning something the catalogue had never heard of played an
// error beep and did nothing. The customer is standing there holding the item,
// so "nothing" is not an answer — the cashier ends up either turning them away
// or ringing it up as something else, which corrupts the numbers quietly.
//
// So the miss becomes a prompt: name it, price it, sell it.
//
// Only for someone holding the `inventory` permission. A cashier without it
// gets told the code is unknown and nothing else -- pricing an unknown item is
// a pricing decision, and that is the permission they do not have. See the
// guard in ProPOSLayout.
// =============================================

import { useEffect, useRef, useState } from "react";
import { Loader2, ScanBarcode, X } from "lucide-react";
import { parseLlInput, type EditScope } from "./CartLineEditor";
import { logActivity } from "@/lib/activity/logger";

interface UnknownBarcodePromptProps {
  barcode: string;
  busy?: boolean;
  onDismiss: () => void;
  onSubmit: (
    input: { name: string; unitPriceLl: number },
    scope: EditScope
  ) => void;
}

export default function UnknownBarcodePrompt({
  barcode,
  busy = false,
  onDismiss,
  onSubmit,
}: UnknownBarcodePromptProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);

  // Focus on mount. A NEW barcode remounts this component rather than
  // resetting it — the parent keys it on the code — so there is nothing to
  // clear here: the cashier has moved on to the next item and gets a fresh
  // form for it.
  useEffect(() => {
    nameRef.current?.focus();
    logActivity("ui.modal_open", {
      target: "unknown barcode",
      details: { kind: "unknown_barcode", barcode },
    });
    // The prompt is keyed on the barcode, so it unmounts when the cashier moves
    // on — whether they priced the item or walked away from it. Recording the
    // discard here is what separates "did not sell it" from "sold it".
    return () => {
      if (!submittedRef.current) {
        logActivity("ui.modal_discard", {
          target: "unknown barcode",
          details: { kind: "unknown_barcode", barcode },
        });
      }
    };
    // Mount/unmount only: a new barcode is a new component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsedPrice = parseLlInput(price);
  const canSubmit = !busy && name.trim().length > 0 && parsedPrice !== null;

  const submit = (scope: EditScope) => {
    if (!canSubmit || parsedPrice === null) return;
    submittedRef.current = true;
    logActivity("ui.modal_submit", {
      target: "unknown barcode",
      details: { kind: "unknown_barcode", barcode, scope, name: name.trim(), price_ll: parsedPrice },
    });
    onSubmit({ name: name.trim(), unitPriceLl: parsedPrice }, scope);
  };


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit("inventory");
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="mt-2 rounded-2xl border border-primary/40 bg-primary/[0.06] p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <ScanBarcode className="h-4 w-4 flex-none text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-primary tnum">
          New barcode {barcode} — name it to save it
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="tap flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">Product name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="Product name"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-xl border border-white/[0.12] bg-card px-3 text-sm font-medium outline-none focus:border-primary/60"
          />
        </label>

        <label className="flex-none">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Price LL
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={price}
            disabled={busy}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            autoComplete="off"
            aria-label="Price in Lebanese Pounds"
            className="h-12 w-32 rounded-xl border border-white/[0.12] bg-card px-3 text-right text-sm font-bold outline-none tnum focus:border-primary/60"
          />
        </label>

        <button
            type="button"
            onClick={() => submit("inventory")}
            disabled={!canSubmit}
            className="tap flex h-12 flex-none items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save &amp; add
            <kbd className="rounded bg-black/15 px-1 py-0.5 text-[10px] font-bold">⏎</kbd>
          </button>

        <button
          type="button"
          onClick={() => submit("sale")}
          disabled={!canSubmit}
          className="tap h-12 flex-none rounded-xl border border-white/[0.12] px-4 text-sm font-bold text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          This sale only
        </button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        &ldquo;Save &amp; add&rdquo; creates the product so the next scan finds it.
        &ldquo;This sale only&rdquo; sells it once and leaves the catalogue alone.
      </p>
    </div>
  );
}
