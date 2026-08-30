"use client";

// =============================================
// Combo editor — what a meal contains
// =============================================
// Lives in the product dialog, next to the recipe editor. A recipe says what a
// sandwich is MADE of; a combo says what a meal INCLUDES.
//
// The live comparison against the separate prices is the point of the screen:
// an owner sets a meal price by looking at what the parts come to, and a deal
// that accidentally costs MORE than buying separately is the one mistake worth
// catching before it reaches a menu board.
// =============================================

import { useMemo } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { formatLL } from "@/lib/utils/format";
import { SELL_RATE } from "@/lib/utils/format";
import { validateComboComponent } from "@/lib/combos/types";

/** The minimum a combo editor needs about a product it can include. */
export interface ComboItemOption {
  id: string;
  name: string;
  selling_price: number;
  currency: string;
}

/** A row being edited. No id — the server rewrites the whole set. */
export interface DraftComboItem {
  item_product_id: string;
  quantity: number;
  sort_order: number;
}

interface ComboEditorProps {
  /** Sellable products that may go in a combo (never ingredients, never itself). */
  options: ComboItemOption[];
  items: DraftComboItem[];
  onChange: (next: DraftComboItem[]) => void;
  /** The combo's own price, in LL, as currently typed in the form. */
  comboPriceLl: number;
  disabled?: boolean;
}

/** A product's price in LL, whatever it is priced in. */
function priceLl(option: ComboItemOption): number {
  return option.currency === "USD"
    ? option.selling_price * SELL_RATE
    : option.selling_price;
}

export function newDraftComboItem(sortOrder: number): DraftComboItem {
  return { item_product_id: "", quantity: 1, sort_order: sortOrder };
}

export default function ComboEditor({
  options,
  items,
  onChange,
  comboPriceLl,
  disabled = false,
}: ComboEditorProps) {
  const byId = useMemo(() => {
    const map = new Map<string, ComboItemOption>();
    for (const o of options) map.set(o.id, o);
    return map;
  }, [options]);

  /** What the contents would cost bought separately. */
  const separately = useMemo(
    () =>
      items.reduce((sum, item) => {
        const option = byId.get(item.item_product_id);
        return option ? sum + priceLl(option) * item.quantity : sum;
      }, 0),
    [items, byId]
  );

  const saving = separately - comboPriceLl;

  const update = (index: number, patch: Partial<DraftComboItem>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  const remove = (index: number) =>
    onChange(items.filter((_, i) => i !== index).map((it, i) => ({ ...it, sort_order: i })));

  const add = () => onChange([...items, newDraftComboItem(items.length)]);

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nothing to put in a combo yet</p>
        <p className="mt-1">
          Add the products you sell on their own first — a sandwich, fries, a drink —
          then bundle them here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Not a combo. Add products below to bundle them at one price.
        </p>
      )}

      {items.map((item, index) => {
        const option = byId.get(item.item_product_id);
        const error = validateComboComponent(item);

        return (
          <div key={index} className="rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <select
                value={item.item_product_id}
                disabled={disabled}
                onChange={(e) => update(index, { item_product_id: e.target.value })}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">Choose a product…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>

              <div className="flex flex-none items-center rounded-lg bg-muted/70">
                <button
                  type="button"
                  disabled={disabled || item.quantity <= 1}
                  onClick={() => update(index, { quantity: item.quantity - 1 })}
                  aria-label="Fewer"
                  className="tap flex h-11 w-9 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-bold tnum">{item.quantity}</span>
                <button
                  type="button"
                  disabled={disabled || item.quantity >= 99}
                  onClick={() => update(index, { quantity: item.quantity + 1 })}
                  aria-label="More"
                  className="tap flex h-11 w-9 items-center justify-center rounded-lg text-primary disabled:opacity-30"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label="Remove from combo"
                className="tap flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {option && (
              <p className="mt-2 text-xs text-muted-foreground tnum">
                {item.quantity} × {formatLL(priceLl(option))} ={" "}
                {formatLL(priceLl(option) * item.quantity)} on its own
              </p>
            )}
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add to combo
      </button>

      {items.length > 0 && separately > 0 && (
        <div className="rounded-xl border border-border p-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Bought separately</span>
            <span className="tnum">{formatLL(separately)}</span>
          </div>
          <div className="mt-1 flex justify-between font-semibold">
            <span>This combo</span>
            <span className="tnum">{formatLL(comboPriceLl)}</span>
          </div>
          <div
            className={`mt-1 flex items-start gap-1.5 ${
              saving > 0 ? "text-emerald-400" : "text-destructive"
            }`}
          >
            {saving <= 0 && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />}
            <span className="text-xs">
              {saving > 0 ? (
                <>Customer saves {formatLL(saving)}</>
              ) : saving === 0 ? (
                <>No saving — this costs the same as buying the parts.</>
              ) : (
                <>
                  This combo costs {formatLL(-saving)} MORE than buying the parts
                  separately. Check the price.
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
