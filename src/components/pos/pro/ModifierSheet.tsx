"use client";

// =============================================
// Modifier sheet — build a made-to-order line
// =============================================
// "Fries Sandwich — no pickles, extra cheese."
//
// Built on the existing dialog primitive, following ConfirmDialog as the house
// pattern. There is deliberately no sheet/popover/select primitive in
// components/ui, and this feature should not introduce one.
//
// ## Permission
//
// Gated on `pos`, NOT on `inventory`. Choosing a listed add-on at a price the
// owner set is ORDERING, not pricing — the same act as adding a product to the
// cart. Behind `inventory`, no plain cashier could take a sandwich order, which
// defeats the feature. Free-typing a price stays behind `inventory`, unchanged.
// =============================================

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  formatLL,
  formatUSD,
  convertLlToUsdForReturn,
  SELL_RATE,
} from "@/lib/utils/format";
import type { Product } from "@/lib/types/product";
import type { CartLineModifier } from "@/lib/types/cart";
import type { RecipeComponent } from "@/lib/recipes/types";

interface ModifierSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  components: RecipeComponent[];
  /** Names of the ingredients, by product id. From the catalogue. */
  ingredientNames: Map<string, string>;
  /** Editing an existing line: its current choices. Null when adding. */
  initial?: CartLineModifier[] | null;
  onConfirm: (modifiers: CartLineModifier[]) => void;
}

/**
 * The line's starting choices: every component present, defaults included.
 *
 * EVERY component is stored, including untouched ones as 'included'. That is
 * what lets the sale-time stock expansion need no external lookup, and lets a
 * kitchen ticket render from the line alone.
 */
function initialModifiers(
  components: RecipeComponent[],
  names: Map<string, string>,
): CartLineModifier[] {
  return components.map((c) => ({
    component_id: c.id,
    ingredient_product_id: c.ingredient_product_id,
    name: names.get(c.ingredient_product_id) || "Ingredient",
    state: c.is_default ? "included" : "removed",
    ingredient_qty: c.quantity,
    price_delta_ll: c.price_delta_ll,
    count: c.is_default ? 1 : 0,
    is_default_component: c.is_default,
  }));
}

/** LL charged for the add-ons on one unit. Mirrors extrasOf() in cartStore. */
function extrasOf(modifiers: CartLineModifier[]): number {
  let total = 0;
  for (const m of modifiers) {
    if (m.state !== "extra") continue;
    const extraUnits = Math.max(0, m.count - (m.is_default_component ? 1 : 0));
    total += m.price_delta_ll * extraUnits;
  }
  return total;
}

/** Derive the state a count implies, so the two can never disagree. */
function stateForCount(
  count: number,
  isDefault: boolean,
): CartLineModifier["state"] {
  if (count <= 0) return "removed";
  if (isDefault && count === 1) return "included";
  return "extra";
}

/**
 * The Dialog shell. The body is a separate, KEYED component so that opening the
 * sheet for a different product remounts it and its useState initialiser does
 * the resetting — rather than an effect that setStates on open, which triggers
 * a cascading render.
 */
export default function ModifierSheet({
  open,
  onOpenChange,
  product,
  components,
  ingredientNames,
  initial,
  onConfirm,
}: ModifierSheetProps) {
  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <ModifierBody
          key={`${product.id}:${initial ? "edit" : "new"}`}
          product={product}
          components={components}
          ingredientNames={ingredientNames}
          initial={initial}
          onCancel={() => onOpenChange(false)}
          onConfirm={(modifiers) => {
            onConfirm(modifiers);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ModifierBody({
  product,
  components,
  ingredientNames,
  initial,
  onCancel,
  onConfirm,
}: {
  product: Product;
  components: RecipeComponent[];
  ingredientNames: Map<string, string>;
  initial?: CartLineModifier[] | null;
  onCancel: () => void;
  onConfirm: (modifiers: CartLineModifier[]) => void;
}) {
  const [modifiers, setModifiers] = useState<CartLineModifier[]>(() =>
    initial && initial.length > 0
      ? initial.map((m) => ({ ...m }))
      : initialModifiers(components, ingredientNames),
  );

  /** Ceiling per component, from the recipe. */
  const maxById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of components) map.set(c.id, c.max_quantity);
    return map;
  }, [components]);

  const removableById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const c of components) map.set(c.id, c.is_removable);
    return map;
  }, [components]);

  const baseLl = product
    ? product.currency === "USD"
      ? product.selling_price * SELL_RATE
      : product.selling_price
    : 0;
  const discount = product?.discount_percentage || 0;
  const discountedBase = discount > 0 ? baseLl * (1 - discount / 100) : baseLl;
  const extras = extrasOf(modifiers);
  // Exact, unrounded — rounding to 5,000 happens once, on the cart total.
  const lineTotal = discountedBase + extras;

  const setCount = (componentId: string, next: number) => {
    setModifiers((prev) =>
      prev.map((m) => {
        if (m.component_id !== componentId) return m;
        const max = maxById.get(componentId) ?? 1;
        const removable = removableById.get(componentId) ?? true;
        // A non-removable default cannot go below one — the bun stays.
        const floor = m.is_default_component && !removable ? 1 : 0;
        const count = Math.max(floor, Math.min(max, next));
        return {
          ...m,
          count,
          state: stateForCount(count, m.is_default_component),
        };
      }),
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription>
          Tap to change what goes in. Removing something does not reduce the
          price.
        </DialogDescription>
      </DialogHeader>

      <ul className="space-y-2">
        {modifiers.map((m) => {
          const max = maxById.get(m.component_id) ?? 1;
          const removable = removableById.get(m.component_id) ?? true;
          const locked = m.is_default_component && !removable && max === 1;

          return (
            <li
              key={m.component_id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                m.state === "removed"
                  ? "border-border opacity-60"
                  : "border-border"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    m.state === "removed" ? "line-through" : ""
                  }`}
                >
                  {m.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locked
                    ? "Always included"
                    : m.state === "removed"
                      ? "Removed"
                      : m.price_delta_ll > 0 && max > 1
                        ? `${formatLL(m.price_delta_ll)} per extra`
                        : m.is_default_component
                          ? "Included"
                          : "Free"}
                </p>
              </div>

              {locked ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-none items-center rounded-xl bg-muted/70">
                  <button
                    type="button"
                    aria-label={`Less ${m.name}`}
                    disabled={
                      m.count <= (m.is_default_component && !removable ? 1 : 0)
                    }
                    onClick={() => setCount(m.component_id, m.count - 1)}
                    className="tap flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-6 text-center text-sm font-bold tnum">
                    {m.count}
                  </span>
                  <button
                    type="button"
                    aria-label={`More ${m.name}`}
                    disabled={m.count >= max}
                    onClick={() => setCount(m.component_id, m.count + 1)}
                    className="tap flex h-10 w-10 items-center justify-center rounded-xl text-primary disabled:opacity-30"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {modifiers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This item has no recipe — nothing to change.
        </p>
      )}

      <div className="rounded-xl border border-border p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Line total</span>
          <span className="text-lg font-bold tnum">{formatLL(lineTotal)}</span>
        </div>
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            {extras > 0 ? `includes ${formatLL(extras)} of extras` : ""}
          </span>
          <span className="tnum">
            {formatUSD(convertLlToUsdForReturn(lineTotal))}
          </span>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onConfirm(modifiers)}>
          {initial ? "Save changes" : "Add to cart"}
        </Button>
      </DialogFooter>
    </>
  );
}
