"use client";

// =============================================
// Desktop till — the Pro layout
//
// Replaces the old desktop branch of /pos, which was the mobile screen with
// the camera swapped for a barcode box. This is built for the machine it runs
// on: a wide screen, a keyboard, a wedge scanner, and often a touchscreen.
//
// Four things live here that did not exist before:
//   - lanes, so a parked customer does not cost the cashier the cart
//   - one input that tells a scan from a search
//   - an unknown barcode that becomes a prompt instead of an error beep
//   - editing a line's name and price, for this sale or for the catalogue
//
// Pricing is a permission. Everything on this screen that decides what a
// customer is charged -- retyping a line's price, renaming it, naming an
// unknown barcode -- is gated on `inventory`, and gated in ONE place
// (`canEditInventory` below) so the cart, the row and the capture strip cannot
// drift apart on it. A cashier without it can scan, change quantities, remove
// lines and take payment; they cannot invent a price.
// =============================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, ScanBarcode, Loader2, X, AlertTriangle } from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useToastManager } from "@/hooks/useToastManager";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import { syncEngine } from "@/lib/sync/engine";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { playSuccessSound, playErrorSound } from "@/lib/feedback";
import { formatLL, formatUSD } from "@/lib/utils/format";
import { cachedToProduct } from "@/lib/products/refresh";
import { createProduct, repriceProduct } from "@/lib/products/write";
import { isOneOffLine } from "@/lib/pos/lineItems";
import { lineKey } from "@/lib/pos/lineKey";
import { logActivity } from "@/lib/activity/logger";
import type { Product } from "@/lib/types/product";
import type { CartItem } from "@/lib/types/cart";

import LaneTabs from "./LaneTabs";
import RegisterIndicator from "@/components/pos/RegisterIndicator";
import SmartScanInput from "./SmartScanInput";
import UnknownBarcodePrompt from "./UnknownBarcodePrompt";
import ProCartRow from "./ProCartRow";
import CartLineEditor, { type EditScope, type LineEditPatch } from "./CartLineEditor";
import ProTotalsPanel from "./ProTotalsPanel";
import QuickGrid from "./QuickGrid";
import MenuBrowser from "./MenuBrowser";
import ModifierSheet from "./ModifierSheet";
import { useMenuSheet } from "./useMenuSheet";
import type { Category } from "@/lib/categories/types";
import type { RecipeMap } from "@/lib/recipes/types";
import PanelResizer, { usePanelWidth } from "./PanelResizer";
import { useScanFocus } from "./useScanFocus";

/** How often the WAITING badges recompute. */
const LANE_TICK_MS = 1000;

interface ProPOSLayoutProps {
  products: Product[];
  savedProducts: Product[];
  /** Menu categories for the browse rail. Empty for a retail store. */
  categories: Category[];
  /** Every recipe in the store, by menu product id. Empty for a retail store. */
  recipes: RecipeMap;
  /** Ingredient names for the modifier sheet, by product id. */
  ingredientNames: Map<string, string>;
  /** Every ingredient in inventory — anything can be added to anything. */
  ingredients: Product[];
  storeId: string;
  /** Adds to the active lane, with the page's variant/discount resolution. */
  onProductAdd: (product: Product) => void;
  /** Local index first, then the server. Null means genuinely unknown. */
  resolveBarcode: (barcode: string) => Promise<Product | null>;
  /** A product was created or changed here; fold it into the page's state. */
  onProductUpserted: (product: Product) => void;
  highlightedItemId: string | null;
  onCheckout: () => void;
}

export default function ProPOSLayout({
  products,
  savedProducts,
  categories,
  recipes,
  ingredientNames,
  ingredients,
  storeId,
  onProductAdd,
  resolveBarcode,
  onProductUpserted,
  highlightedItemId,
  onCheckout,
}: ProPOSLayoutProps) {
  const { canAccess } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const { toast } = useToastManager({ throttleMs: 1200 });

  // ---- Cart / lanes ----
  const items = useCartStore((s) => s.items);
  const lanes = useCartStore((s) => s.lanes);
  const laneOrder = useCartStore((s) => s.laneOrder);
  const activeLaneId = useCartStore((s) => s.activeLaneId);
  const getLaneSummaries = useCartStore((s) => s.getLaneSummaries);
  const canOpenLane = useCartStore((s) => s.canOpenLane);
  const openLane = useCartStore((s) => s.openLane);
  const closeLane = useCartStore((s) => s.closeLane);
  const switchLane = useCartStore((s) => s.switchLane);
  const switchLaneByPosition = useCartStore((s) => s.switchLaneByPosition);
  const addOneOffItem = useCartStore((s) => s.addOneOffItem);
  const updateLine = useCartStore((s) => s.updateLine);
  const incrementQuantity = useCartStore((s) => s.incrementQuantity);
  const decrementQuantity = useCartStore((s) => s.decrementQuantity);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const getTotal = useCartStore((s) => s.getTotal);
  const getTotalUsd = useCartStore((s) => s.getTotalUsd);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount);
  const getRoundingAdjustment = useCartStore((s) => s.getRoundingAdjustment);
  const isEmpty = useCartStore((s) => s.isEmpty);

  // ---- Local UI state ----
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [laneToClose, setLaneToClose] = useState<string | null>(null);
  // Emptying the active lane, which is NOT the same as closing it — a lane
  // being cleared must still be there afterwards to scan into.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [tick, setTick] = useState(0);
  // Catalogue writes the server refused outright. These products exist on this
  // device and nowhere else, and nothing will retry them.
  const [failedWrites, setFailedWrites] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Cart / quick-grid split ----
  // Remembered per device. The panel's width is applied inline so the drag can
  // write straight to the DOM without re-rendering the grid; commitWidth is the
  // only thing that touches React state.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef<HTMLDivElement | null>(null);
  const { width: panelWidth, commitWidth } = usePanelWidth();

  // ---- Permissions ----
  // The single gate for every price-setting affordance on this screen. Also
  // requires the store to have the inventory feature at all — with it off
  // there is nowhere to manage what would be created.
  // One rule, shared with the mobile menu page — see useMenuSheet.
  const {
    configuring,
    setConfiguring,
    handleTileAdd,
    handleEditModifiers,
    handleConfirm,
    sheetProps,
  } = useMenuSheet({
    recipes,
    products,
    enabled: isEnabled("menu_items"),
    onPlainAdd: onProductAdd,
  });

  const canEditInventory = isEnabled("inventory") && canAccess("inventory");

  // Focus belongs to the scan field unless something else legitimately owns the
  // keyboard. A wedge scanner types wherever the caret is, so focus resting on
  // the last button pressed means the next scan is silently lost.
  const keyboardBusy =
    editingLineId !== null ||
    unknownBarcode !== null ||
    laneToClose !== null ||
    clearConfirmOpen ||
    // A half-configured sandwich is exactly the typed state a service-worker
    // reload would throw away, and the sheet owns the keyboard while it is up.
    configuring !== null ||
    isWriting;
  useScanFocus(searchInputRef, keyboardBusy);

  // A half-typed new product, or a line mid-edit, is exactly the state a
  // service-worker reload would throw away. The cart alone does not cover it:
  // the capture strip can be open with an empty cart.
  useReloadGuard(
    keyboardBusy,
    "pos-pro-editing"
  );

  // A rejected catalogue write used to fail into the console and nothing else,
  // so the till went on selling a product the server had never heard of. Check
  // on mount and after every sync cycle, and say so on screen.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { getFailedProductWrites } = await import("@/lib/db/localDB");
      const failed = await getFailedProductWrites();
      if (cancelled) return;
      setFailedWrites(
        failed.map((w) => {
          const p = w.payload as { product?: { name?: string } } | undefined;
          return (p && p.product && p.product.name) || "Unnamed product";
        })
      );
    };
    void check();
    const unsubscribe = syncEngine.subscribe(() => void check());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const retryFailedWrites = useCallback(async () => {
    const { retryFailedProductWrites } = await import("@/lib/db/localDB");
    const n = await retryFailedProductWrites();
    setFailedWrites([]);
    logActivity("sync.retry_requested", { details: { count: n } });
    if (n > 0) {
      toast.info(`Retrying ${n} product${n === 1 ? "" : "s"}…`);
      void syncEngine.syncNow();
    }
  }, [toast]);

  const dismissFailedWrites = useCallback(async () => {
    const { getFailedProductWrites, dismissFailedProductWrite } = await import(
      "@/lib/db/localDB"
    );
    const failed = await getFailedProductWrites();
    for (const w of failed) await dismissFailedProductWrite(w.id);
    setFailedWrites([]);
    // Dismissing is a decision to accept that the local catalogue and the
    // server now disagree. It should never happen without a trace.
    logActivity("sync.dismissed", {
      details: { count: failed.length, ids: failed.map((w) => w.id).slice(0, 10) },
    });
  }, []);

  // ---- Lane summaries ----
  // Recomputed on a 1s tick ONLY while a parked lane could be counting up.
  // With one lane, or every lane empty, there is nothing to animate and the
  // interval never starts.
  const needsTick = useMemo(
    () => laneOrder.some((id) => id !== activeLaneId && (lanes[id]?.items.length ?? 0) > 0),
    [laneOrder, activeLaneId, lanes]
  );

  useEffect(() => {
    if (!needsTick) return;
    const timer = setInterval(() => setTick((t) => t + 1), LANE_TICK_MS);
    return () => clearInterval(timer);
  }, [needsTick]);

  const summaries = useMemo(
    () => getLaneSummaries(),
    // `tick` is what advances the WAITING clocks; the rest are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getLaneSummaries, lanes, laneOrder, activeLaneId, items, tick]
  );

  /** The catalogue row behind a cart line, when there is one. */
  const catalogFor = useCallback(
    (item: CartItem) =>
      isOneOffLine(item) ? undefined : products.find((p) => p.id === item.product_id),
    [products]
  );

  // ---- Barcode ----

  const handleBarcode = useCallback(
    async (barcode: string) => {
      setIsResolving(true);
      try {
        const product = await resolveBarcode(barcode);
        if (product) {
          setUnknownBarcode(null);
          logActivity("catalog.scan_hit", {
            target: product.name,
            details: { barcode, product_id: product.id },
          });
          onProductAdd(product);
          return;
        }
        // The customer is standing there holding it, so a miss is a prompt,
        // not a dead end.
        playErrorSound();
        // A miss is worth more than a hit: it is either a gap in the catalogue
        // or a cashier about to price something by hand.
        logActivity("catalog.scan_miss", {
          target: barcode,
          details: { can_edit_inventory: canEditInventory },
        });
        setUnknownBarcode(barcode);
      } finally {
        setIsResolving(false);
      }
    },
    [resolveBarcode, onProductAdd, canEditInventory]
  );

  /** Name + price for a code the catalogue does not have. */
  const handleUnknownSubmit = useCallback(
    async (input: { name: string; unitPriceLl: number }, scope: EditScope) => {
      const barcode = unknownBarcode;
      // The guard is re-checked here, not just at the render site: this is the
      // function that actually writes, so it is the one that has to be safe.
      if (!barcode) return;
      if (!canEditInventory) {
        // A refused pricing attempt is exactly what an owner wants to see.
        logActivity("auth.permission_denied", {
          target: "price unknown barcode",
          details: { permission: "inventory", barcode, scope },
        });
        return;
      }

      if (scope === "sale") {
        addOneOffItem({ name: input.name, unitPriceLl: input.unitPriceLl, barcode });
        playSuccessSound();
        toast.success(`Added ${input.name} — this sale only`, { key: "cart-add" });
        setUnknownBarcode(null);
        return;
      }

      setIsWriting(true);
      try {
        const { product, syncedNow } = await createProduct({
          store_id: storeId,
          name: input.name,
          barcode,
          selling_price: input.unitPriceLl,
          currency: "LL",
        });
        const mapped = cachedToProduct(product);
        onProductUpserted(mapped);
        // Added as a REAL product line, not a one-off: the sale is then
        // attributed to the product for reporting, and a second scan of the
        // same item increments the line instead of creating another.
        onProductAdd(mapped);
        toast.success(
          syncedNow
            ? `Saved ${input.name} to inventory`
            : `Saved ${input.name} — will sync when back online`,
          { key: "cart-add" }
        );
        setUnknownBarcode(null);
      } catch (error: unknown) {
        console.error("[POS] Unknown barcode capture failed:", error);
        toast.error(
          error instanceof Error ? error.message : "Could not save that product"
        );
      } finally {
        setIsWriting(false);
      }
    },
    [
      unknownBarcode,
      canEditInventory,
      addOneOffItem,
      storeId,
      onProductUpserted,
      onProductAdd,
      toast,
    ]
  );

  // ---- Line editing ----

  const handleLineSave = useCallback(
    async (item: CartItem, patch: LineEditPatch, scope: EditScope) => {
      if (!canEditInventory) {
        logActivity("auth.permission_denied", {
          target: "edit cart line",
          details: { permission: "inventory", product_id: item.product_id, scope },
        });
        return;
      }

      // Whichever scope was chosen, this sale takes the new figures. Someone is
      // waiting at the counter for the price they were quoted.
      if (scope === "sale") {
        // lineKey(), NOT product_id: two configured lines of the same product
        // must be repriced independently.
        updateLine(lineKey(item), { name: patch.name, unitPriceLl: patch.unitPriceLl });
        setEditingLineId(null);
        return;
      }

      setIsWriting(true);
      try {
        if (isOneOffLine(item)) {
          // A line with no catalogue row behind it: "Inventory" means create.
          const { product, syncedNow } = await createProduct({
            store_id: storeId,
            name: patch.name,
            barcode: item.barcode,
            selling_price: patch.catalogPrice,
            currency: patch.catalogCurrency,
          });
          onProductUpserted(cachedToProduct(product));
          toast.success(
            syncedNow
              ? `Added ${patch.name} to inventory`
              : `Saved ${patch.name} — will sync when back online`
          );
        } else {
          const { product, syncedNow, preview } = await repriceProduct({
            productId: item.product_id,
            storeId,
            name: patch.name,
            sellingPrice: patch.catalogPrice,
            currency: patch.catalogCurrency,
          });
          // Fold the new figures back into the page's catalogue state, so the
          // search list and the quick grid show the price that was just set
          // rather than the one it replaced.
          onProductUpserted(cachedToProduct(product));
          toast.success(
            syncedNow
              ? `Inventory updated to ${
                  preview.currency === "USD"
                    ? formatUSD(preview.sellingPrice)
                    : formatLL(preview.sellingPrice)
                }`
              : `Saved — will sync when back online`
          );
        }

        // lineKey(), NOT product_id: two configured lines of the same product
        // must be repriced independently.
        updateLine(lineKey(item), { name: patch.name, unitPriceLl: patch.unitPriceLl });
        setEditingLineId(null);
      } catch (error: unknown) {
        console.error("[POS] Line inventory write failed:", error);
        toast.error(
          error instanceof Error ? error.message : "Could not save that change"
        );
      } finally {
        setIsWriting(false);
      }
    },
    [updateLine, canEditInventory, storeId, onProductUpserted, toast]
  );

  // ---- Lanes ----

  const requestCloseLane = useCallback(
    (laneId: string) => {
      const lane = lanes[laneId];
      const laneItems = laneId === activeLaneId ? items : lane?.items ?? [];
      if (laneItems.length === 0) {
        closeLane(laneId);
        return;
      }
      // A lane with shopping in it needs confirming, so this is the point where
      // the cashier is asked — the answer is logged by the dialog below.
      logActivity("ui.modal_open", {
        target: "close lane",
        details: { lane_id: laneId, lines: laneItems.length },
      });
      setLaneToClose(laneId);
    },
    [lanes, activeLaneId, items, closeLane]
  );

  const laneToCloseSummary = laneToClose
    ? summaries.find((s) => s.id === laneToClose)
    : undefined;

  // ---- Keyboard ----
  //
  // Owned here rather than by the page: every one of these targets something
  // this component renders, and this component only exists on desktop.
  //
  // They fire even while an input has focus. On a wedge till the scan field
  // holds focus essentially all the time — it re-focuses itself after every
  // scan — so a "bail out if the target is an input" guard would mean the
  // shortcuts almost never worked on the one layout they exist for. F-keys
  // type no characters, and ALT+digit types none either.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // A confirmation dialog owns the keyboard while it is up.
      if (laneToClose || clearConfirmOpen) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        switchLaneByPosition(Number(e.key));
        // The generic ui.shortcut row records the keypress; this records that
        // the till acted on it, which is not the same thing when the lane does
        // not exist.
        logActivity("ui.shortcut", {
          target: `ALT+${e.key}`,
          details: { action: "switch_lane", position: Number(e.key) },
        });
        // Focus follows the lane: the next scan belongs to whoever just
        // stepped up to the counter.
        setEditingLineId(null);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (e.key === "F1" || e.key === "F3") {
        // Chrome opens its help centre on F1; preventDefault suppresses that.
        // F3 is kept as an alias for muscle memory from the old two-field
        // layout, where it focused the separate barcode box.
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === "F4") {
        e.preventDefault();
        if (!isEmpty()) {
          logActivity("sale.checkout_open", { target: "F4", details: { source: "shortcut" } });
          onCheckout();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [switchLaneByPosition, isEmpty, onCheckout, laneToClose, clearConfirmOpen]);

  /**
   * Menu mode: browse by category instead of the quick-access grid.
   *
   * Requires categories to actually exist — a rail with nothing in it is worse
   * than the grid it replaced. With the flag off this is false and the right
   * panel renders exactly what it always did.
   */
  const menuMode = isEnabled("product_categories") && categories.length > 0;


  const editingItem = editingLineId
    ? items.find((i) => lineKey(i) === editingLineId)
    : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <LaneTabs
        summaries={summaries}
        canOpen={canOpenLane()}
        onSwitch={(id) => {
          switchLane(id);
          setEditingLineId(null);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
        onOpen={() => {
          openLane();
          setEditingLineId(null);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
        onClose={requestCloseLane}
      />

      <div ref={splitRef} className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        {/* ================= LEFT: scan + cart ================= */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-shrink-0">
            {failedWrites.length > 0 && (
              <div className="mb-2 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-destructive">
                    {failedWrites.length === 1
                      ? "A product could not be saved to the server"
                      : `${failedWrites.length} products could not be saved to the server`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {failedWrites.slice(0, 3).join(", ")}
                    {failedWrites.length > 3 ? ` and ${failedWrites.length - 3} more` : ""} —
                    sellable here, but not on your other devices. Re-enter them from
                    Inventory.
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1">
                  {/* A rejected payload is not rejected forever — a deploy that
                      fixes the cause makes every stranded write viable again,
                      and nothing notices that on its own. */}
                  <button
                    type="button"
                    onClick={() => void retryFailedWrites()}
                    className="tap rounded-lg bg-destructive/20 px-2.5 py-1.5 text-[11px] font-bold text-destructive hover:bg-destructive/30"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissFailedWrites()}
                    className="tap rounded-lg px-2 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <SmartScanInput
              products={products}
              onSelectProduct={onProductAdd}
              onBarcode={handleBarcode}
              inputRef={searchInputRef}
              disabled={isWriting}
            />

            {isResolving && (
              <p className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking that barcode…
              </p>
            )}

            {unknownBarcode &&
              (canEditInventory ? (
                <UnknownBarcodePrompt
                  // Remounts on a new code, which is what clears the half-typed
                  // name and price from the previous one.
                  key={unknownBarcode}
                  barcode={unknownBarcode}
                  busy={isWriting}
                  onDismiss={() => {
                    setUnknownBarcode(null);
                    searchInputRef.current?.focus();
                  }}
                  onSubmit={handleUnknownSubmit}
                />
              ) : (
                /* No pricing permission, so no fields — but still say what
                   happened. Silence would read as a broken scanner, and the
                   cashier needs to know to fetch someone rather than keep
                   scanning. */
                <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/[0.1] bg-muted/40 p-3">
                  <ScanBarcode className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    <span className="font-bold text-foreground tnum">{unknownBarcode}</span>{" "}
                    is not in the catalogue. Someone with inventory access needs to
                    add it before it can be sold.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setUnknownBarcode(null);
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Dismiss"
                    className="tap flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border bg-card">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
                <ScanLine className="mb-4 h-12 w-12 opacity-25" />
                <p className="text-lg font-semibold">Scan items to add</p>
                <p className="mt-1 text-sm">
                  Or type a product name above — F1 jumps there
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-shrink-0 items-baseline justify-between px-5 pb-2 pt-4">
                  <h2 className="text-lg font-bold">
                    Cart{" "}
                    <span className="text-sm font-medium text-muted-foreground">
                      · {items.length} item{items.length !== 1 ? "s" : ""} ·{" "}
                      {getItemCount()} unit{getItemCount() !== 1 ? "s" : ""}
                    </span>
                  </h2>
                  {/* Which drawer this till rings into. Renders nothing at all
                      unless the cash-register feature is on, so single-drawer
                      stores see no new chrome. */}
                  <RegisterIndicator />
                  <button
                    type="button"
                    onClick={() => setClearConfirmOpen(true)}
                    className="tap -mr-2 rounded-lg px-2 py-1 text-sm font-semibold text-destructive"
                  >
                    Clear
                  </button>
                </div>

                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                  {items.map((item) => (
                    <ProCartRow
                      key={lineKey(item)}
                      item={item}
                      isHighlighted={highlightedItemId === lineKey(item)}
                      isEditing={editingLineId === lineKey(item)}
                      onIncrement={incrementQuantity}
                      onDecrement={decrementQuantity}
                      onSetQuantity={updateQuantity}
                      onRemove={(id) => {
                        if (editingLineId === id) setEditingLineId(null);
                        removeItem(id);
                      }}
                      canEdit={canEditInventory}
                      onEditModifiers={
                        isEnabled("menu_items") ? handleEditModifiers : undefined
                      }
                      onOpenEditor={(id) =>
                        setEditingLineId((current) => (current === id ? null : id))
                      }
                      editor={
                        editingItem && lineKey(editingItem) === lineKey(item) ? (
                          <CartLineEditor
                            key={lineKey(item)}
                            item={editingItem}
                            product={catalogFor(editingItem)}
                            busy={isWriting}
                            onCancel={() => {
                              setEditingLineId(null);
                              searchInputRef.current?.focus();
                            }}
                            onSave={(patch, scope) =>
                              handleLineSave(editingItem, patch, scope)
                            }
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* The split is the cashier's to set — see PanelResizer. */}
        <PanelResizer
          panelRef={sidePanelRef}
          containerRef={splitRef}
          width={panelWidth}
          onCommit={commitWidth}
          onDragEnd={() => searchInputRef.current?.focus()}
        />

        {/* ================= RIGHT: totals + quick grid ================= */}
        <div
          ref={sidePanelRef}
          style={{ width: panelWidth }}
          className="flex flex-none flex-col overflow-hidden"
        >
          <div className="flex-shrink-0 rounded-3xl border bg-card">
            <ProTotalsPanel
              total={getTotal()}
              totalUsd={getTotalUsd()}
              unitCount={getItemCount()}
              totalDiscount={getTotalDiscount()}
              roundingAdjustment={getRoundingAdjustment()}
              isEmpty={isEmpty()}
              onCheckout={onCheckout}
            />
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-3xl border bg-card">
            {menuMode ? (
              <MenuBrowser
                products={products}
                categories={categories}
                onAdd={handleTileAdd}
              />
            ) : (
              <QuickGrid products={savedProducts} onAdd={onProductAdd} />
            )}
          </div>
        </div>
      </div>

      <ModifierSheet
        {...sheetProps}
        onOpenChange={(open) => {
          if (!open) setConfiguring(null);
        }}
        ingredientNames={ingredientNames}
        ingredients={ingredients}
        onConfirm={(modifiers, note) => {
          handleConfirm(modifiers, note);
          searchInputRef.current?.focus();
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear this cart?"
        description="Removes every item from this lane. The lane itself stays open."
        details={
          <div className="rounded-2xl bg-muted/50 px-4 py-3">
            <p className="font-semibold">
              {getItemCount()} unit{getItemCount() !== 1 ? "s" : ""} in the cart
            </p>
            <p className="mt-0.5 text-muted-foreground tnum">{formatLL(getTotal())}</p>
          </div>
        }
        cancelLabel="Keep them"
        confirmLabel="Clear"
        onConfirm={() => {
          clearCart();
          setClearConfirmOpen(false);
          setEditingLineId(null);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
      />

      <ConfirmDialog
        open={laneToClose !== null}
        onOpenChange={(open) => {
          if (!open) setLaneToClose(null);
        }}
        title={
          laneToCloseSummary
            ? `Clear ${laneToCloseSummary.label}?`
            : "Clear this lane?"
        }
        description="The items in it are discarded. This cannot be undone."
        details={
          laneToCloseSummary ? (
            <div className="rounded-2xl bg-muted/50 px-4 py-3">
              <p className="font-semibold">
                {laneToCloseSummary.unitCount} unit
                {laneToCloseSummary.unitCount !== 1 ? "s" : ""} in{" "}
                {laneToCloseSummary.label}
              </p>
              <p className="mt-0.5 text-muted-foreground tnum">
                {formatLL(laneToCloseSummary.total)}
              </p>
            </div>
          ) : null
        }
        cancelLabel="Keep it"
        confirmLabel="Discard"
        onConfirm={() => {
          if (laneToClose) closeLane(laneToClose);
          setLaneToClose(null);
          setEditingLineId(null);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
      />
    </div>
  );
}
