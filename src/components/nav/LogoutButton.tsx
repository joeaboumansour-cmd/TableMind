"use client";

// =============================================
// Sign out, with the cart guard attached
//
// Lives next to the desktop nav rather than inside the POS page because the
// warning it shows is about the CART, and the cart is global state — it
// survives navigation, so a cashier can hand the till over from any screen,
// not just /pos.
//
// The POS page already had this confirmation, but only the mobile branch used
// it: the desktop header's logout button called the handler directly, so a
// till with a full cart signed out with no warning at all. Consolidating here
// closes that gap.
//
// The confirm itself is ConfirmDialog, so signing out carries the same
// five-second cooldown as every other destructive action.
// =============================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/lib/auth/AuthContext";
import { useCartStore } from "@/lib/stores/cartStore";
import { formatLL } from "@/lib/utils/format";

/**
 * The confirm on its own, so other surfaces can raise it.
 *
 * The account dialog has a "Log out" row and must show the same cart warning
 * and the same cooldown; giving it its own copy is how the two would end up
 * disagreeing about what signing out costs.
 */
export function LogoutConfirm({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { logout } = useAuth();

  const isEmpty = useCartStore((s) => s.isEmpty);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const getTotal = useCartStore((s) => s.getTotal);
  const itemCount = getItemCount();

  const setOpen = onOpenChange;

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Log out?"
        // Accurate now that PINs exist: a cashier who has set one on this
        // device gets back in with four digits. The second sentence points at
        // Lock, which is what a break actually calls for — logging out to visit
        // the toilet is the friction this whole feature exists to remove.
        description="You can sign back in with your PIN, or your username and password. Just stepping away? Lock the till instead."
        // An open cart is the reason this needs a confirm at all — it survives
        // the logout, but the cashier should know that before they hand the
        // till over.
        details={
          !isEmpty() ? (
            <div className="rounded-2xl bg-muted/50 px-4 py-3">
              <p className="font-semibold">
                {itemCount} item{itemCount !== 1 ? "s" : ""} still in the cart
              </p>
              <p className="mt-0.5 text-muted-foreground tnum">
                {formatLL(getTotal())} — kept on this device and still here after you
                log back in.
              </p>
            </div>
          ) : null
        }
        cancelLabel="Stay"
        confirmLabel="Log out"
        confirmIcon={<LogOut className="h-4 w-4" />}
        onConfirm={() => {
          setOpen(false);
          logout();
          router.push("/login");
        }}
      />
    </>
  );
}

export default function LogoutButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label="Log out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
      <LogoutConfirm open={open} onOpenChange={setOpen} />
    </>
  );
}
