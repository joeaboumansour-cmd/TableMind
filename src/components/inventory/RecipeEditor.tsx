"use client";

// =============================================
// Recipe editor — what a menu item is made of
// =============================================
// Lives inside the product dialog on the inventory page. Only shown for a
// SELLABLE product, and only when the `menu_items` flag is on.
//
// The servings hint is the main defence against the one silent way this
// feature loses money: an owner entering pickles as 4 (jars) and then writing
// a recipe of 20 (grams) sees "200 servings" become "0 servings" while they
// type, which is the moment the mistake is cheap to catch.
// =============================================

import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { formatLL } from "@/lib/utils/format";
import { formatStock } from "@/lib/products/kind";
import { validateComponent, type RecipeComponent } from "@/lib/recipes/types";

/** The minimum an ingredient row needs from the catalogue. */
export interface IngredientOption {
  id: string;
  name: string;
  stock_quantity: number;
  stock_unit?: string | null;
}

/** A component being edited. No id — the server rewrites the whole set. */
export type DraftComponent = Omit<RecipeComponent, "id" | "menu_product_id">;

interface RecipeEditorProps {
  ingredients: IngredientOption[];
  components: DraftComponent[];
  onChange: (next: DraftComponent[]) => void;
  disabled?: boolean;
}

export function newDraftComponent(sortOrder: number): DraftComponent {
  return {
    ingredient_product_id: "",
    quantity: 1,
    is_default: true,
    is_removable: true,
    max_quantity: 1,
    price_delta_ll: 0,
    sort_order: sortOrder,
  };
}

export default function RecipeEditor({
  ingredients,
  components,
  onChange,
  disabled = false,
}: RecipeEditorProps) {
  const [touched, setTouched] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, IngredientOption>();
    for (const item of ingredients) map.set(item.id, item);
    return map;
  }, [ingredients]);

  const update = (index: number, patch: Partial<DraftComponent>) => {
    setTouched(true);
    onChange(components.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const remove = (index: number) => {
    setTouched(true);
    onChange(
      components.filter((_, i) => i !== index).map((c, i) => ({ ...c, sort_order: i }))
    );
  };

  const add = () => {
    setTouched(true);
    onChange([...components, newDraftComponent(components.length)]);
  };

  if (ingredients.length === 0) {
    return (
      <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No ingredients yet</p>
        <p className="mt-1">
          Add products with type <strong>Ingredient</strong> first — flour, bread, pickles —
          then come back and build the recipe here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {components.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No recipe. This product sells as a plain item and depletes its own stock.
        </p>
      )}

      {components.map((component, index) => {
        const ingredient = byId.get(component.ingredient_product_id);
        const error = touched ? validateComponent(component) : null;

        // How many of this menu item the ingredient's stock can cover. The
        // number an owner needs to see the moment they mistype a unit.
        const servings =
          ingredient && component.quantity > 0
            ? Math.floor(ingredient.stock_quantity / component.quantity)
            : null;

        return (
          <div key={index} className="rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <select
                value={component.ingredient_product_id}
                disabled={disabled}
                onChange={(e) => update(index, { ingredient_product_id: e.target.value })}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">Choose an ingredient…</option>
                {ingredients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label="Remove ingredient"
                className="min-h-11 min-w-11 rounded-lg border border-border text-muted-foreground disabled:opacity-50"
              >
                <Trash2 className="mx-auto h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">
                Quantity per item
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    value={component.quantity}
                    disabled={disabled}
                    onChange={(e) => update(index, { quantity: parseFloat(e.target.value) || 0 })}
                    className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                  />
                  <span className="shrink-0 text-sm text-foreground">
                    {ingredient?.stock_unit || ""}
                  </span>
                </div>
              </label>

              <label className="text-xs text-muted-foreground">
                Max per item
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="99"
                  value={component.max_quantity}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, { max_quantity: parseInt(e.target.value, 10) || 1 })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                />
              </label>
            </div>

            {/* Extra price only matters when more than one is allowed. */}
            {component.max_quantity > 1 && (
              <label className="mt-2 block text-xs text-muted-foreground">
                Price per extra (LL)
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1000"
                  value={component.price_delta_ll}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, { price_delta_ll: parseFloat(e.target.value) || 0 })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                />
                <span className="mt-1 block">
                  {component.price_delta_ll > 0
                    ? `${formatLL(component.price_delta_ll)} for each extra`
                    : "Free"}
                </span>
              </label>
            )}

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={component.is_default}
                  disabled={disabled}
                  onChange={(e) => update(index, { is_default: e.target.checked })}
                  className="h-4 w-4"
                />
                Comes with it
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={component.is_removable}
                  disabled={disabled || !component.is_default}
                  onChange={(e) => update(index, { is_removable: e.target.checked })}
                  className="h-4 w-4"
                />
                Can be removed
              </label>
            </div>

            {ingredient && servings !== null && (
              <p
                className={`mt-2 flex items-start gap-1 text-xs ${
                  servings === 0 ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {servings === 0 && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
                <span>
                  Uses {component.quantity} {ingredient.stock_unit || "unit"} of{" "}
                  {formatStock(ingredient.stock_quantity, ingredient.stock_unit)} in stock
                  {" — "}
                  <strong>{servings}</strong> {servings === 1 ? "serving" : "servings"} left
                  {servings === 0 && ". Check the unit is right."}
                </span>
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
        Add ingredient
      </button>
    </div>
  );
}
