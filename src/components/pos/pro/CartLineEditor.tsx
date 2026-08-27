"use client";

// =============================================
// Edit a cart line in place (desktop Pro till)
//
// Two different questions share one panel, because from behind the counter
// they feel like the same act:
//
//   "This sale"  — the shelf label was wrong, charge this instead. Touches the
//                  cart only.
//   "Inventory"  — the shelf label was wrong AND the catalogue is wrong. Also
//                  writes the product.
//
// They are NOT the same number, and the first version of this panel wrongly
// treated them as one:
//
//   - a cart LINE is charged in LL. That is what the drawer takes, and for a
//     USD-priced product it is a figure derived at the sell rate.
//   - a catalogue PRODUCT has its own currency. A USD-priced product is meant
//     to track the rate, so writing the derived LL number back into it pins it
//     to a fixed amount and silently ends that.
//   - a discounted line's unit price is the DISCOUNTED price. Writing that to
//     the catalogue as the new base price applies the discount twice.
//
// So the price field changes meaning with the scope, says which currency it is
// in, and shows what the change actually does before it is made.
//
// This panel is only ever rendered for someone who holds the `inventory`
// permission. A cashier without it cannot retype a price at all -- not for the
// catalogue and not for a single sale -- because "just this once" is exactly
// how a till gets used to undercharge, and the cart is where the money is
// decided. See the guard in ProPOSLayout.
// =============================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatLL,
  formatUSD,
  convertUsdToLl,
  convertLlToUsdForReturn,
} from "@/lib/utils/format";
import type { CartItem } from "@/lib/types/cart";
import type { Product } from "@/lib/types/product";

export type EditScope = "sale" | "inventory";
export type PriceCurrency = "LL" | "USD";

/** Digits (and an optional decimal point) out of whatever was typed. */
export function parseLlInput(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export interface LineEditPatch {
  name: string;
  /** What this sale charges per unit, in LL. Always present. */
  unitPriceLl: number;
  /** Catalogue price + currency. Only meaningful for the inventory scope. */
  catalogPrice: number;
  catalogCurrency: PriceCurrency;
}

interface CartLineEditorProps {
  item: CartItem;
  /** The catalogue row behind this line, when there is one. */
  product?: Product;
  busy?: boolean;
  onCancel: () => void;
  onSave: (patch: LineEditPatch, scope: EditScope) => void;
}

export default function CartLineEditor({
  item,
  product,
  busy = false,
  onCancel,
  onSave,
}: CartLineEditorProps) {
  const isOneOff = item.line_kind === "one_off";

  // The catalogue's own currency and price. A one-off has no catalogue row, so
  // it starts from what the cashier is charging, in LL.
  const catalogCurrency: PriceCurrency =
    product && product.currency === "USD" ? "USD" : "LL";
  const catalogPrice = product ? product.selling_price : item.unit_price;
  const catalogDiscount = product ? product.discount_percentage || 0 : 0;

  const [name, setName] = useState(item.product_name);
  const [scope, setScope] = useState<EditScope>("sale");
  // Two independent drafts. Switching scope must not carry an LL charge across
  // into a USD catalogue field, or vice versa.
  const [salePrice, setSalePrice] = useState(String(Math.round(item.unit_price)));
  const [invPrice, setInvPrice] = useState(
    catalogCurrency === "USD" ? String(catalogPrice) : String(Math.round(catalogPrice))
  );
  const [invCurrency, setInvCurrency] = useState<PriceCurrency>(catalogCurrency);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const isInventory = scope === "inventory";
  const parsedSale = parseLlInput(salePrice);
  const parsedInv = parseLlInput(invPrice);
  const activeParsed = isInventory ? parsedInv : parsedSale;

  const nameChanged = name.trim().length > 0 && name.trim() !== item.product_name;
  const priceChanged = isInventory
    ? parsedInv !== null && (parsedInv !== catalogPrice || invCurrency !== catalogCurrency)
    : parsedSale !== null && parsedSale !== Math.round(item.unit_price);

  const canSave =
    !busy && activeParsed !== null && name.trim().length > 0 && (priceChanged || nameChanged);

  /** What the inventory change will actually do, shown before it is made. */
  const preview = useMemo(() => {
    if (!isInventory || parsedInv === null) return null;
    const ll = invCurrency === "USD" ? convertUsdToLl(parsedInv) : parsedInv;
    const usd = invCurrency === "USD" ? parsedInv : convertLlToUsdForReturn(parsedInv);
    return {
      ll,
      usd,
      effective: ll * (1 - catalogDiscount / 100),
      currencyChanged: !isOneOff && invCurrency !== catalogCurrency,
    };
  }, [isInventory, parsedInv, invCurrency, catalogDiscount, isOneOff, catalogCurrency]);

  const commit = () => {
    if (!canSave || activeParsed === null) return;
    const invLl =
      parsedInv === null
        ? item.unit_price
        : invCurrency === "USD"
          ? convertUsdToLl(parsedInv)
          : parsedInv;

    onSave(
      {
        name: name.trim(),
        // The inventory scope also changes what this sale charges, because
        // someone is standing at the counter waiting for the price they were
        // quoted. The LL figure is derived from the catalogue price so the two
        // cannot disagree.
        unitPriceLl: isInventory ? invLl : (parsedSale as number),
        catalogPrice: parsedInv === null ? catalogPrice : parsedInv,
        catalogCurrency: invCurrency,
      },
      scope
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    // F-keys bubble: the POS shortcuts stay live while a line is being edited.
  };

  const inventoryLabel = isOneOff ? "Add to inventory" : "Inventory";

  return (
    <div
      className="mt-2 rounded-2xl border border-primary/25 bg-background/60 p-2"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={nameRef}
          type="text"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          aria-label="Product name"
          autoComplete="off"
          spellCheck={false}
          className="h-11 min-w-[180px] flex-1 rounded-xl border border-white/[0.1] bg-card px-3 text-sm font-medium outline-none focus:border-primary/60"
        />

        {/* ---- Price. Its meaning and its currency follow the scope. ---- */}
        <div className="flex h-11 flex-none items-center gap-2 rounded-xl border border-primary/50 bg-card pl-3 pr-1">
          <span className="text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-muted-foreground">
            {isInventory ? "Catalogue" : "This sale"}
          </span>
          <input
            type="text"
            // Not type="number": its spinners and locale parsing are more
            // trouble than filtering the digits ourselves, and a till keyboard
            // is a real keyboard.
            inputMode="decimal"
            value={isInventory ? invPrice : salePrice}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if (isInventory) setInvPrice(v);
              else setSalePrice(v);
            }}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={
              isInventory
                ? `Catalogue price in ${invCurrency === "USD" ? "US Dollars" : "Lebanese Pounds"}`
                : "Price for this sale in Lebanese Pounds"
            }
            autoComplete="off"
            className="w-24 bg-transparent text-right text-sm font-bold outline-none tnum"
          />

          {isInventory ? (
            // A USD-priced product must be able to stay USD. Forcing every edit
            // to LL is what pinned rate-tracking products to a fixed amount.
            <div className="flex flex-none items-center rounded-lg bg-muted/60 p-0.5">
              {(["LL", "USD"] as PriceCurrency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setInvCurrency(c)}
                  disabled={busy}
                  className={cn(
                    "tap h-8 rounded-md px-2 text-[11px] font-bold transition-colors",
                    invCurrency === c
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <span className="px-2 text-[11px] font-bold text-muted-foreground">LL</span>
          )}
        </div>

        {(
          <div className="flex h-11 flex-none items-center rounded-xl bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setScope("sale")}
              disabled={busy}
              className={cn(
                "tap h-9 rounded-lg px-3 text-xs font-bold transition-colors",
                scope === "sale"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              This sale
            </button>
            <button
              type="button"
              onClick={() => setScope("inventory")}
              disabled={busy}
              className={cn(
                "tap h-9 rounded-lg px-3 text-xs font-bold transition-colors",
                scope === "inventory"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {inventoryLabel}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={commit}
          disabled={!canSave}
          className="tap flex h-11 flex-none items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
          <kbd className="rounded bg-black/15 px-1 py-0.5 text-[10px] font-bold">⏎</kbd>
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="tap h-11 flex-none rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      {/* ---- What this is about to do ---- */}
      {isInventory ? (
        <div className="mt-2 space-y-1 px-1 text-[11px] text-muted-foreground">
          {preview && (
            <p className="tnum">
              {isOneOff ? "Creates" : "Sets"} the catalogue price to{" "}
              <span className="font-semibold text-foreground">
                {invCurrency === "USD" ? formatUSD(preview.usd) : formatLL(preview.ll)}
              </span>{" "}
              <span className="opacity-70">
                ({invCurrency === "USD" ? formatLL(preview.ll) : formatUSD(preview.usd)})
              </span>
              {!isOneOff && (
                <>
                  {" · was "}
                  <span className="line-through opacity-70">
                    {catalogCurrency === "USD"
                      ? formatUSD(catalogPrice)
                      : formatLL(catalogPrice)}
                  </span>
                </>
              )}
            </p>
          )}
          {preview?.currencyChanged && (
            <p className="font-semibold text-amber-400">
              Changes this product from {catalogCurrency} to {invCurrency} pricing.
              {catalogCurrency === "USD" &&
                " It will stop following the exchange rate."}
            </p>
          )}
          {catalogDiscount > 0 && preview && (
            <p className="tnum">
              The {catalogDiscount}% discount stays on, so customers pay{" "}
              <span className="font-semibold text-emerald-400">
                {formatLL(preview.effective)}
              </span>
              .
            </p>
          )}
          <p>Applies to this sale as well.</p>
        </div>
      ) : (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          Changes what this sale charges. The catalogue is left alone.
          {item.discount_percentage > 0 &&
            ` Replaces the ${item.discount_percentage}% discount on this line.`}
        </p>
      )}
    </div>
  );
}
