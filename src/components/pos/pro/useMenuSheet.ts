"use client";

// =============================================
// The modifier-sheet decision, in one place
// =============================================
// "Does tapping this tile open the sheet, or add it straight to the cart?" is
// a rule about money and stock, and both tills ask it — the desktop Pro layout
// and the mobile menu page. Duplicating it would let the two drift, so it
// lives here and both call it.
// =============================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCartStore } from "@/lib/stores/cartStore";
import { lineKey } from "@/lib/pos/lineKey";
import { playSuccessSound } from "@/lib/feedback";
import type { Product } from "@/lib/types/product";
import type { CartItem, CartLineModifier } from "@/lib/types/cart";
import type { RecipeMap } from "@/lib/recipes/types";
import { isCombo, resolveCombo, type ComboMap } from "@/lib/combos/types";

interface UseMenuSheetOptions {
  recipes: RecipeMap;
  /** Every combo in the store. Empty for a store that has none. */
  combos: ComboMap;
  /**
   * SELLABLE products — what a tile can add and what a cart line maps back to.
   * Deliberately excludes ingredients.
   */
  products: Product[];
  /**
   * Names for the WHOLE catalogue, ingredients included.
   *
   * Resolving a combo has to name the ingredients inside its children's
   * recipes, and those are precisely the rows `products` leaves out — so
   * looking them up there produced the literal word "Item" for every one of
   * them. Anything that has to name an ingredient uses this map.
   */
  productNames: Map<string, string>;
  /**
   * What one extra portion of an ingredient costs, in LL — its own
   * selling_price. A combo resolves its children's recipes and must price an
   * extra exactly as a standalone sandwich would.
   */
  ingredientPrices: Map<string, number>;
  /** True when the store has the menu_items feature on. */
  enabled: boolean;
  /** Falls back to this when the tapped product has no recipe. */
  onPlainAdd: (product: Product) => void;
  /**
   * Does this device KNOW what is on the menu — audit P1-12.
   *
   * False means the recipes and combos have never reached this device, not
   * that there are none. In that window a menu item is indistinguishable from
   * a bottle of water, so deciding now would silently sell it as a plain line.
   *
   * Defaults to TRUE, which is exactly today's behaviour, so a caller that has
   * not been migrated to the data layer yet is unaffected.
   */
  menuDataReady?: boolean;
  /**
   * Wait — briefly, and with a cap — for the menu data to arrive. Required for
   * `menuDataReady: false` to mean anything; without it the decision is made
   * immediately, as before.
   */
  awaitMenuData?: () => Promise<{ recipes: RecipeMap; combos: ComboMap }>;
}

export interface MenuSheetSubject {
  product: Product;
  /** null = building a NEW line; set = editing an existing line's choices. */
  lineId: string | null;
}

export function useMenuSheet({
  recipes,
  combos,
  products,
  productNames,
  ingredientPrices,
  enabled,
  onPlainAdd,
  menuDataReady = true,
  awaitMenuData,
}: UseMenuSheetOptions) {
  const [configuring, setConfiguring] = useState<MenuSheetSubject | null>(null);

  const items = useCartStore((s) => s.items);
  const addConfiguredItem = useCartStore((s) => s.addConfiguredItem);
  const addComboItem = useCartStore((s) => s.addComboItem);
  const updateItemModifiers = useCartStore((s) => s.updateItemModifiers);

  /**
   * The decision itself, against a GIVEN menu.
   *
   * Takes `recipes` and `combos` as arguments rather than closing over them,
   * because the P1-12 path below decides after an await and the values it must
   * use are the ones that just arrived, not the ones the closure captured.
   */
  const decide = useCallback(
    (product: Product, menuRecipes: RecipeMap, menuCombos: ComboMap) => {
      // A COMBO is rung up as the meal as advertised: one line, one price, no
      // sheet. It is not "configured" on the way in — a cashier who needs
      // "no pickles" edits the line afterwards, exactly as on a standalone
      // sandwich. Checked FIRST, because a combo could also happen to have a
      // recipe of its own and the meal must win.
      if (enabled && isCombo(menuCombos, product.id)) {
        // productNames covers the WHOLE catalogue. `products` is sellable-only,
        // so using it here named every ingredient "Item".
        const nameOf = (id: string) =>
          productNames.get(id) || products.find((p) => p.id === id)?.name || "Item";
        const priceOf = (id: string) => ingredientPrices.get(id) ?? 0;
        const { children, modifiers } = resolveCombo(
          product.id,
          menuCombos,
          menuRecipes,
          nameOf,
          priceOf
        );
        addComboItem(product, children, modifiers);
        playSuccessSound();
        return;
      }

      const components = menuRecipes[product.id];
      // Only a product WITH a recipe opens the sheet on the way in. Anything
      // else goes straight to the cart, so selling a bottle of water stays one
      // tap — it can still be customised afterwards from the cart row.
      if (enabled && components && components.length > 0) {
        setConfiguring({ product, lineId: null });
        return;
      }
      onPlainAdd(product);
    },
    [products, productNames, ingredientPrices, enabled, onPlainAdd, addComboItem]
  );

  /**
   * The latest `decide`.
   *
   * The held path below resumes on a LATER render than the one it started on —
   * that is what holding means — and by then everything `decide` closes over
   * may have changed. `enabled` is the one that bites: on a first-ever launch
   * the hold is waiting precisely for `menu_items` to resolve from false to
   * true, so calling the captured `decide` would use the very value the wait
   * existed to replace, and sell the sandwich plain anyway.
   */
  const decideRef = useRef(decide);
  // In an effect, not during render: writing a ref while rendering is the thing
  // the React lint rule forbids, and the held path always resumes after a
  // commit, so an effect is early enough by construction.
  useEffect(() => {
    decideRef.current = decide;
  }, [decide]);

  /**
   * A tile was tapped, or a barcode was scanned. An item with a recipe opens
   * the sheet; anything else goes straight into the cart, exactly as it did
   * before menus existed.
   *
   * Returns a promise so the caller can keep its "resolving" affordance up for
   * the P1-12 hold — the desktop scan path awaits it. On the ordinary path it
   * is already settled, and nothing about a warm till changes.
   */
  const handleTileAdd = useCallback(
    async (product: Product): Promise<void> => {
      // The common case, and every case on a store without menus: we know what
      // the menu is, so decide now with no await at all.
      if (menuDataReady || !awaitMenuData) {
        decide(product, recipes, combos);
        return;
      }

      // Audit P1-12: this device has never been told what is on the menu, so
      // "no recipe" is an absence, not an answer. Hold the product for a beat
      // and decide against whatever arrives — including nothing, which is the
      // old behaviour reached deliberately rather than by mistake.
      const settled = await awaitMenuData();
      decideRef.current(product, settled.recipes, settled.combos);
    },
    [decide, recipes, combos, menuDataReady, awaitMenuData]
  );

  /**
   * Open the sheet for a line already in the cart.
   *
   * Works on ANY line, with or without a recipe: in a snack shop every
   * sellable product is customisable, because an ingredient can be added to
   * anything and a note can be left on anything.
   *
   * A one-off line is the exception — it has no catalogue row, so there is no
   * product to build a sheet around.
   */
  const handleEditModifiers = useCallback(
    (item: CartItem) => {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) return;
      setConfiguring({ product, lineId: lineKey(item) });
    },
    [products]
  );

  const handleConfirm = useCallback(
    (modifiers: CartLineModifier[], note: string) => {
      if (!configuring) return;
      if (configuring.lineId) {
        updateItemModifiers(configuring.lineId, modifiers, note);
      } else {
        addConfiguredItem(configuring.product, modifiers, 1, note);
        playSuccessSound();
      }
      setConfiguring(null);
    },
    [configuring, addConfiguredItem, updateItemModifiers]
  );

  /** The current line when editing, so the sheet opens pre-filled. */
  const editingLine = useMemo(() => {
    if (!configuring?.lineId) return null;
    return items.find((i) => lineKey(i) === configuring.lineId) ?? null;
  }, [configuring, items]);

  /**
   * `initial` doubles as the "am I editing?" flag for the sheet's button label
   * and remount key, so an existing line with no modifiers yet must still
   * produce an array rather than null.
   */
  const initial = editingLine ? editingLine.modifiers ?? [] : null;

  const components = configuring ? recipes[configuring.product.id] || [] : [];

  return {
    configuring,
    setConfiguring,
    handleTileAdd,
    handleEditModifiers,
    handleConfirm,
    /** Spread straight onto <ModifierSheet />, minus onOpenChange. */
    sheetProps: {
      open: configuring !== null,
      product: configuring?.product ?? null,
      components,
      initial,
      initialNote: editingLine?.note ?? "",
    },
  };
}
