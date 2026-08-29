"use client";

// =============================================
// One cart line (desktop Pro till)
//
// Everything on this row is a permanent, finger-sized control. The layout it
// replaces revealed − / + and the remove button on :hover, which fails twice
// on a touchscreen till: hover never fires for a tap, and where it does fire
// it sticks to the last row touched. So nothing here is hidden, and the name
// and the price are themselves buttons — tapping either opens the editor.
// =============================================

import { Minus, Plus, X, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLL, formatUSD } from "@/lib/utils/format";
import CartQuantityInput from "@/components/pos/CartQuantityInput";
import type { CartItem } from "@/lib/types/cart";
import { lineKey } from "@/lib/pos/lineKey";
import { describeModifiers } from "@/lib/pos/modifierSummary";

interface ProCartRowProps {
  item: CartItem;
  isHighlighted: boolean;
  isEditing: boolean;
  /**
   * Whether the name and price open an editor. False for a cashier without the
   * `inventory` permission: setting a price is a pricing decision, and a
   * tappable field that refuses on tap is worse than a field that is plainly
   * not a control.
   */
  canEdit: boolean;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onOpenEditor: (productId: string) => void;
  /**
   * Reopen the modifier sheet for this line. Absent when the store has no menu
   * items, in which case no line can carry modifiers anyway.
   *
   * Gated on `pos`, not `canEdit`: choosing a listed add-on at the owner's
   * price is ordering, not pricing.
   */
  onEditModifiers?: (item: CartItem) => void;
  /** The editor panel, rendered by the parent so it owns the save handlers. */
  editor?: React.ReactNode;
}

/**
 * The name and the price are buttons when they open an editor and plain text
 * when they do not — rather than a disabled button, which still looks pressable
 * on a touch till and invites a tap that does nothing.
 */
function Field({
  canEdit,
  onClick,
  className,
  children,
}: {
  canEdit: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  if (!canEdit) {
    return <div className={className}>{children}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("tap hover:bg-white/[0.04]", className)}
    >
      {children}
    </button>
  );
}

export default function ProCartRow({
  item,
  isHighlighted,
  isEditing,
  canEdit,
  onIncrement,
  onDecrement,
  onSetQuantity,
  onRemove,
  onOpenEditor,
  onEditModifiers,
  editor,
}: ProCartRowProps) {
  const isOneOff = item.line_kind === "one_off";
  const hasDiscount = item.discount_percentage > 0;
  const edited = item.is_price_overridden || item.is_name_overridden;

  /**
   * Only the CHANGES are shown. Listing everything a sandwich contains would
   * bury the one line that matters — the cashier needs to see "no pickles",
   * not a recital of the recipe.
   */
  const modifierChips = describeModifiers(item.modifiers).map((label) => ({
    key: label,
    label,
    removed: label.startsWith("No "),
  }));

  return (
    <div
      id={`cart-item-${lineKey(item)}`}
      className={cn(
        "animate-cart-item-in rounded-2xl px-2 py-2 transition-colors duration-300",
        isHighlighted
          ? "bg-primary/15 ring-1 ring-primary/60"
          : isEditing
            ? "bg-muted/40 ring-1 ring-primary/25"
            : "ring-1 ring-transparent"
      )}
    >
      <div className="flex items-center gap-2">
        {/* ---- Quantity ---- */}
        <div className="flex flex-none items-center rounded-xl bg-muted/70">
          <button
            type="button"
            aria-label={`Decrease ${item.product_name}`}
            onClick={() => onDecrement(lineKey(item))}
            className="tap flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
          >
            <Minus className="h-5 w-5" />
          </button>
          <CartQuantityInput
            quantity={item.quantity}
            productName={item.product_name}
            onCommit={(q) => onSetQuantity(lineKey(item), q)}
          />
          <button
            type="button"
            aria-label={`Increase ${item.product_name}`}
            onClick={() => onIncrement(lineKey(item))}
            className="tap flex h-11 w-11 items-center justify-center rounded-xl text-primary hover:text-primary/80"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {/* ---- Name + unit price. Both open the editor. ---- */}
        <Field
          canEdit={canEdit}
          onClick={() => onOpenEditor(lineKey(item))}
          className="min-w-0 flex-1 rounded-xl px-2 py-1 text-left"
        >
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold leading-tight">
              {item.product_name}
            </span>
            {isOneOff && (
              <span className="flex-none rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.08em] text-muted-foreground">
                One-off
              </span>
            )}
            {edited && (
              <Tag className="h-3 w-3 flex-none text-primary" aria-label="Edited" />
            )}
          </span>
          {modifierChips.length > 0 && (
            <span
              className="mt-1 flex flex-wrap gap-1"
              onClick={(e) => {
                if (!onEditModifiers) return;
                // The name field around this opens the PRICE editor; the chips
                // open the modifier sheet. Stop the outer handler so tapping a
                // chip does not do both.
                e.stopPropagation();
                onEditModifiers(item);
              }}
            >
              {modifierChips.map((chip) => (
                <span
                  key={chip.key}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    chip.removed
                      ? "bg-destructive/15 text-destructive"
                      : "bg-primary/15 text-primary"
                  }`}
                >
                  {chip.label}
                </span>
              ))}
            </span>
          )}
          <span className="mt-0.5 block truncate text-xs text-muted-foreground tnum">
            {hasDiscount ? (
              <>
                <span className="line-through opacity-60">
                  {formatLL(item.original_unit_price)}
                </span>{" "}
                <span className="font-semibold text-emerald-400">
                  {formatLL(item.unit_price)}
                </span>{" "}
                each · −{item.discount_percentage}%
              </>
            ) : (
              <>
                {item.is_price_overridden && item.catalog_unit_price !== undefined && (
                  <span className="line-through opacity-60">
                    {formatLL(item.catalog_unit_price)}{" "}
                  </span>
                )}
                {formatLL(item.unit_price)} · {formatUSD(item.unit_price_usd)} each
              </>
            )}
          </span>
        </Field>

        {/* ---- Line total ---- */}
        <Field
          canEdit={canEdit}
          onClick={() => onOpenEditor(lineKey(item))}
          className="w-[132px] flex-none rounded-xl px-2 py-1 text-right"
        >
          <span className="block text-[15px] font-semibold tnum">
            {formatLL(item.total_price)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground tnum">
            {formatUSD(item.total_price_usd)}
          </span>
        </Field>

        <button
          type="button"
          aria-label={`Remove ${item.product_name}`}
          onClick={() => onRemove(lineKey(item))}
          className="tap flex h-11 w-11 flex-none items-center justify-center rounded-xl text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {isEditing && editor}
    </div>
  );
}
