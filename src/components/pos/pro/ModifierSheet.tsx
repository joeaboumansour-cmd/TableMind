"use client";

// =============================================
// Modifier sheet — customise a line
// =============================================
// "Taouk sandwich, no ketchup, add hummus, cut in half."
//
// In a menu-enabled store EVERY sellable line is customisable, not only the
// ones with a recipe: a product with no recipe still opens here so an
// ingredient or a note can be added to it.
//
// Three sections, in the order a cashier works:
//   1. In this item  — the recipe, each row with a stepper. Removing strikes
//                      it through; adding beyond the default charges.
//   2. Add something — EVERY ingredient in inventory, searchable. Hummus does
//                      not have to be in the sandwich's recipe to go on it.
//   3. Note          — free text for what no ingredient list can say.
//
// ## Pricing
//
// A recipe component charges its own `price_delta_ll` per extra. An ingredient
// added ad-hoc charges the INGREDIENT PRODUCT'S OWN selling_price — the number
// the owner already types in inventory. Set cheddar to 30,000 and adding a
// slice adds 30,000. Leave it 0 and it is free.
//
// ## Permission
//
// Gated on `pos`, NOT on `inventory`. Choosing a listed ingredient at a price
// the owner set is ORDERING, not pricing — the same act as adding a product to
// the cart. Free-typing a price stays behind `inventory`, in the line editor.
// =============================================

import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatLL,
  formatUSD,
  convertLlToUsdForReturn,
  SELL_RATE,
} from "@/lib/utils/format";
import type { Product } from "@/lib/types/product";
import type { CartLineModifier } from "@/lib/types/cart";
import type { RecipeComponent } from "@/lib/recipes/types";

/** Free text is for instructions, not essays. Keeps receipts printable. */
const NOTE_MAX = 140;

/** Marks a modifier as having no recipe row behind it. */
const ADHOC_PREFIX = "adhoc:";

export function isAdhocComponentId(id: string): boolean {
  return id.startsWith(ADHOC_PREFIX);
}

interface ModifierSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  components: RecipeComponent[];
  /** Names of the ingredients, by product id. From the catalogue. */
  ingredientNames: Map<string, string>;
  /** Every ingredient in inventory, so anything can be added to anything. */
  ingredients: Product[];
  /** Editing an existing line: its current choices. Null when adding. */
  initial?: CartLineModifier[] | null;
  /** Editing an existing line: its current note. */
  initialNote?: string;
  onConfirm: (modifiers: CartLineModifier[], note: string) => void;
}

/**
 * The line's starting choices: every recipe component, defaults included.
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
 * sheet for a different line remounts it and its useState initialiser does the
 * resetting — rather than an effect that setStates on open.
 */
export default function ModifierSheet({
  open,
  onOpenChange,
  product,
  components,
  ingredientNames,
  ingredients,
  initial,
  initialNote,
  onConfirm,
}: ModifierSheetProps) {
  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden">
        <ModifierBody
          key={`${product.id}:${initial ? "edit" : "new"}`}
          product={product}
          components={components}
          ingredientNames={ingredientNames}
          ingredients={ingredients}
          initial={initial}
          initialNote={initialNote}
          onCancel={() => onOpenChange(false)}
          onConfirm={(modifiers, note) => {
            onConfirm(modifiers, note);
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
  ingredients,
  initial,
  initialNote,
  onCancel,
  onConfirm,
}: {
  product: Product;
  components: RecipeComponent[];
  ingredientNames: Map<string, string>;
  ingredients: Product[];
  initial?: CartLineModifier[] | null;
  initialNote?: string;
  onCancel: () => void;
  onConfirm: (modifiers: CartLineModifier[], note: string) => void;
}) {
  const [modifiers, setModifiers] = useState<CartLineModifier[]>(() =>
    initial && initial.length > 0
      ? initial.map((m) => ({ ...m }))
      : initialModifiers(components, ingredientNames),
  );
  const [note, setNote] = useState(initialNote || "");
  const [search, setSearch] = useState("");

  /** Ceilings and removability, from the recipe. Ad-hoc rows have neither. */
  const recipeRules = useMemo(() => {
    const map = new Map<string, { max: number; removable: boolean }>();
    for (const c of components) {
      map.set(c.id, { max: c.max_quantity, removable: c.is_removable });
    }
    return map;
  }, [components]);

  const rulesFor = (componentId: string) =>
    // An ad-hoc addition has no recipe row, so no ceiling was ever authored.
    // 9 is a sane till limit rather than an unbounded stepper.
    recipeRules.get(componentId) ?? { max: 9, removable: true };

  /**
   * The rows to actually show, grouped.
   *
   * A COMBO flattens several products' recipes into one list. Shown flat it is
   * an undifferentiated heap — the cashier cannot tell the sandwich's pickles
   * from the drink — so it is grouped under each product of the meal.
   *
   * The `:self` rows are dropped: they exist only so a drink with no recipe
   * still moves stock. There is nothing to change about a canned drink, and
   * showing it as a removable ingredient invites removing it from a paid meal.
   *
   * A non-combo line is one unnamed group, which renders exactly as before.
   */
  const groups = useMemo(() => {
    const visible = modifiers.filter(
      (m) =>
        !(m.combo_child_id && m.combo_child_id === m.ingredient_product_id),
    );

    const isComboLine = visible.some((m) => !!m.combo_child_id);
    if (!isComboLine)
      return [{ key: "", title: null as string | null, rows: visible }];

    const order: string[] = [];
    const byChild = new Map<string, CartLineModifier[]>();
    for (const m of visible) {
      const key = m.combo_child_id || "";
      if (!byChild.has(key)) {
        byChild.set(key, []);
        order.push(key);
      }
      byChild.get(key)!.push(m);
    }
    return order.map((key) => ({
      key,
      title: byChild.get(key)![0].combo_child_name || null,
      rows: byChild.get(key)!,
    }));
  }, [modifiers]);

  /** Children of a combo that have nothing to change — shown, but as fact. */
  const fixedChildren = useMemo(
    () =>
      modifiers.filter(
        (m) => m.combo_child_id && m.combo_child_id === m.ingredient_product_id,
      ),
    [modifiers],
  );

  const onLineIds = useMemo(
    () => new Set(modifiers.map((m) => m.ingredient_product_id)),
    [modifiers],
  );

  /** Ingredients not already on this line, filtered by the search box. */
  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients
      .filter((i) => !onLineIds.has(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, onLineIds, search]);

  const baseLl =
    product.currency === "USD"
      ? product.selling_price * SELL_RATE
      : product.selling_price;
  const discount = product.discount_percentage || 0;
  const discountedBase = discount > 0 ? baseLl * (1 - discount / 100) : baseLl;
  const extras = extrasOf(modifiers);
  // Exact, unrounded — rounding to 5,000 happens once, on the cart total.
  const lineTotal = discountedBase + extras;

  const setCount = (componentId: string, next: number) => {
    setModifiers((prev) =>
      prev.flatMap((m) => {
        if (m.component_id !== componentId) return [m];
        const { max, removable } = rulesFor(componentId);
        // A non-removable default cannot go below one — the bun stays.
        const floor = m.is_default_component && !removable ? 1 : 0;
        const count = Math.max(floor, Math.min(max, next));
        // An ad-hoc addition taken to zero is simply gone: it was never part
        // of the item, so "No hummus" would be a meaningless thing to print.
        if (count === 0 && m.is_adhoc) return [];
        return [
          { ...m, count, state: stateForCount(count, m.is_default_component) },
        ];
      }),
    );
  };

  const addIngredient = (ingredient: Product) => {
    setModifiers((prev) => [
      ...prev,
      {
        component_id: `${ADHOC_PREFIX}${crypto.randomUUID()}`,
        ingredient_product_id: ingredient.id,
        name: ingredient.name,
        state: "extra",
        // ---- An ad-hoc addition is FREE and moves NO stock ----
        //
        // Both zero, deliberately.
        //
        // Price: an ingredient's own selling_price is never used for a
        // modifier. It is a field an owner may have set for entirely
        // unrelated reasons, and charging a customer off the back of it is a
        // mischarge waiting to happen. An add-on costs money only when the
        // owner AUTHORED it as a priced component of that recipe — a
        // deliberate act, with the price stated next to the item it belongs to.
        //
        // Stock: there is no trustworthy portion size for something the recipe
        // never mentioned. Deducting a guessed amount is worse than deducting
        // nothing, because it silently corrupts the count of an ingredient
        // whose real usage nobody is tracking anyway.
        ingredient_qty: 0,
        price_delta_ll: 0,
        count: 1,
        is_default_component: false,
        is_adhoc: true,
      },
    ]);
    setSearch("");
  };

  return (
    <>
      <DialogHeader className="flex-none">
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription>
          Change what goes in, add anything from inventory, or leave a note.
          Removing something does not reduce the price.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {/* ---- 1. What is in it ---- */}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            In this item
          </h3>

          {fixedChildren.length > 0 && (
            <ul className="mb-3 space-y-1">
              {fixedChildren.map((m) => (
                <li
                  key={m.component_id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Included in the combo
                  </span>
                </li>
              ))}
            </ul>
          )}

          {modifiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in it yet. Add something below.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.key}>
                  {group.title && (
                    <p className="mb-1.5 text-xs font-semibold text-foreground">
                      {group.title}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {group.rows.map((m) => {
                      const { max, removable } = rulesFor(m.component_id);
                      const locked =
                        m.is_default_component && !removable && max === 1;
                      const floor =
                        m.is_default_component && !removable ? 1 : 0;
                      const extraUnits = Math.max(
                        0,
                        m.count - (m.is_default_component ? 1 : 0),
                      );

                      return (
                        <li
                          key={m.component_id}
                          className={`flex items-center gap-3 rounded-xl border border-border p-3 ${
                            m.state === "removed" ? "opacity-60" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-medium ${
                                m.state === "removed" ? "line-through" : ""
                              }`}
                            >
                              {m.name}
                              {m.is_adhoc && (
                                <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                                  Added
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {locked
                                ? "Always included"
                                : m.state === "removed"
                                  ? "Removed"
                                  : extraUnits > 0 && m.price_delta_ll > 0
                                    ? `+${formatLL(m.price_delta_ll * extraUnits)}`
                                    : m.price_delta_ll > 0
                                      ? `${formatLL(m.price_delta_ll)} each extra`
                                      : m.is_default_component
                                        ? "Included"
                                        : "Free"}
                            </p>
                          </div>

                          {locked ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <div className="flex flex-none items-center rounded-xl bg-muted/70">
                              <button
                                type="button"
                                aria-label={`Less ${m.name}`}
                                disabled={m.count <= floor}
                                onClick={() =>
                                  setCount(m.component_id, m.count - 1)
                                }
                                className="tap flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground disabled:opacity-30"
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
                                onClick={() =>
                                  setCount(m.component_id, m.count + 1)
                                }
                                className="tap flex h-11 w-11 items-center justify-center rounded-xl text-primary disabled:opacity-30"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- 2. Add anything from inventory ---- */}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Add something
          </h3>

          {ingredients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ingredients in inventory yet.
            </p>
          ) : (
            <>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ingredients…"
                  className="pl-9"
                />
              </div>

              {addable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {search
                    ? "Nothing matches."
                    : "Everything is already on this item."}
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {addable.map((ingredient) => {
                    return (
                      <li key={ingredient.id}>
                        <button
                          type="button"
                          onClick={() => addIngredient(ingredient)}
                          className="tap flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-white/[0.04]"
                        >
                          <Plus className="h-4 w-4 flex-none text-primary" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {ingredient.name}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ---- 3. Note ---- */}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Note for the kitchen
          </h3>
          <div className="relative">
            <Input
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cut in half, extra spicy…"
              className={note ? "pr-9" : undefined}
            />
            {note && (
              <button
                type="button"
                aria-label="Clear note"
                onClick={() => setNote("")}
                className="tap absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="flex-none rounded-xl border border-border p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Each</span>
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

      <DialogFooter className="flex-none">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onConfirm(modifiers, note)}>
          {initial ? "Save changes" : "Add to cart"}
        </Button>
      </DialogFooter>
    </>
  );
}
