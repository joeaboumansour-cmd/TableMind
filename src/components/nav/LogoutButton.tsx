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
// =============================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/AuthContext";
import { useCartStore } from "@/lib/stores/cartStore";
import { formatLL } from "@/lib/utils/format";

export default function LogoutButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { logout } = useAuth();

  const isEmpty = useCartStore((s) => s.isEmpty);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const getTotal = useCartStore((s) => s.getTotal);
  const itemCount = getItemCount();

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>
              You&rsquo;ll need your username and password to get back in.
            </DialogDescription>
          </DialogHeader>

          {/* An open cart is the reason this needs a confirm at all — it
              survives the logout, but the cashier should know that before
              they hand the till over. */}
          {!isEmpty() && (
            <div className="rounded-2xl bg-muted/50 px-4 py-3 text-sm">
              <p className="font-semibold">
                {itemCount} item{itemCount !== 1 ? "s" : ""} still in the cart
              </p>
              <p className="mt-0.5 text-muted-foreground tnum">
                {formatLL(getTotal())} — kept on this device and still here after you
                log back in.
              </p>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="h-12 flex-1 rounded-2xl"
              onClick={() => setOpen(false)}
            >
              Stay
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1 rounded-2xl font-bold"
              onClick={() => {
                setOpen(false);
                logout();
                router.push("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
