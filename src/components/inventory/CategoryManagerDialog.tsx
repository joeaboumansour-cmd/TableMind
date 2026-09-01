"use client";

// =============================================
// Categories manager
// =============================================
// Create, rename, reorder and remove the categories that group products —
// the till's rail and the inventory filter both read this list.
//
// ONLINE ONLY, deliberately. Naming a category is a back-office act, not
// something that can block a sale, so it does not queue through pending_writes
// the way a product create does. The till only needs to READ categories, and
// it reads its own localStorage copy.
// =============================================

import { useEffect, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { CATEGORY_NAME_MAX, type Category } from "@/lib/categories/types";
import { refreshCategories } from "@/lib/categories/load";

interface CategoryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  categories: Category[];
}

export default function CategoryManagerDialog({
  open,
  onOpenChange,
  storeId,
  categories,
}: CategoryManagerDialogProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Category[]>(categories);

  useEffect(() => {
    if (open) setLocal(categories);
  }, [open, categories]);

  /**
   * Re-read from the server. The server is the truth.
   *
   * There is no `onCategoriesChange` any more: `refreshCategories` writes
   * through the categories RESOURCE, so every subscriber — the inventory page
   * behind this dialog and the till's rail — is notified without this
   * component knowing who they are. Pushing a copy up as well would make two
   * writers for one list, which is how the two drift.
   */
  const resync = async () => {
    setLocal(await refreshCategories(storeId));
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ name, sort_order: local.length }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `API error ${response.status}`);
      }
      setNewName("");
      await resync();
      toast.success(`Category "${name}" added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the category");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (category: Category, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === category.name) return;
    setBusy(true);
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ id: category.id, name: trimmed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `API error ${response.status}`);
      }
      await resync();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename the category");
      await resync(); // put the typed name back to what the server actually has
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= local.length) return;
    const reordered = [...local];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setLocal(reordered); // optimistic: reordering should feel instant

    setBusy(true);
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ order: reordered.map((c) => c.id) }),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      await resync();
    } catch {
      toast.error("Could not save the new order");
      await resync();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: Category) => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/categories?category_id=${encodeURIComponent(category.id)}`,
        { method: "DELETE", headers: buildAuthHeaders() }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `API error ${response.status}`);
      }
      const body = (await response.json()) as { outcome?: string };
      await resync();
      // The outcome is decided by the server, not offered as a choice: a
      // category holding products is retired so nothing is un-categorised
      // behind the owner's back. Say which one happened.
      toast.success(
        body.outcome === "retired"
          ? `"${category.name}" is in use, so it was retired rather than deleted. Its products keep their history.`
          : `Category "${category.name}" deleted`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the category");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Groups for the till. Order here is the order on the till.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={newName}
            maxLength={CATEGORY_NAME_MAX}
            placeholder="Sandwiches"
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button type="button" onClick={() => void create()} disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <ul className="space-y-2">
          {local.map((category, index) => (
            <li key={category.id} className="flex items-center gap-2">
              <Input
                defaultValue={category.name}
                maxLength={CATEGORY_NAME_MAX}
                disabled={busy}
                onBlur={(e) => void rename(category, e.target.value)}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() => void move(index, -1)}
                aria-label={`Move ${category.name} up`}
                className="tap flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy || index === local.length - 1}
                onClick={() => void move(index, 1)}
                aria-label={`Move ${category.name} down`}
                className="tap flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground disabled:opacity-40"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(category)}
                aria-label={`Remove ${category.name}`}
                className="tap flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {local.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No categories yet. Add one above — Sandwiches, Drinks, Sides.
          </p>
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
