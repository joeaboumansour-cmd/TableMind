"use client";

// =============================================
// AccountDialog — who am I, where am I, and the session controls.
//
// This app has no settings screen, and adding one for four rows would be a
// bigger change than the feature warrants. The identity label that already sits
// in the desktop nav (and the brand chip in the mobile POS header) is the
// natural place: it is where someone already looks to answer "am I still signed
// in as Rana", which is the same question that precedes "change my PIN".
//
// Lock is here for completeness, but it is NOT the primary entry point — that
// is LockButton, one tap, out in the open. A control this feature exists to
// make cheap must not sit two taps deep.
// =============================================

import { useCallback, useState } from "react";
import {
  KeyRound,
  Lock,
  LogOut,
  Store as StoreIcon,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/AuthContext";
import type { StoreUser } from "@/lib/auth/permissions";
import {
  hasPin,
  clearPin,
  setPin,
  getCachedStoreUsernameForStoreId,
} from "@/lib/auth/offlineAuth";
import { useLockTill } from "./LockButton";
import PinSetupCard from "./PinSetupCard";
import { initialsFor } from "@/lib/auth/initials";
import { logActivity } from "@/lib/activity/logger";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function Row({
  icon,
  label,
  hint,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  tone?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/40",
        tone === "destructive" && "hover:border-destructive/40",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          tone === "destructive"
            ? "bg-destructive/12 text-destructive"
            : "bg-primary/12 text-primary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[14px] font-semibold",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </span>
        {hint && (
          <span className="block truncate text-[12px] text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

export function AccountDialog({
  open,
  onOpenChange,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The host owns sign-out, because it also owns the confirm and the routing. */
  onLogout: () => void;
}) {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {/* The body mounts and unmounts with the dialog, so it reads the PIN
            state fresh in a useState INITIALISER on every open rather than
            syncing it from an effect. A PIN set on the login screen since this
            was last shown must not still read as absent — and an effect that
            setState's on open is a cascading render for something we can simply
            read at mount. */}
        {open && (
          <AccountBody
            user={user}
            onOpenChange={onOpenChange}
            onLogout={onLogout}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountBody({
  user,
  onOpenChange,
  onLogout,
}: {
  user: StoreUser;
  onOpenChange: (open: boolean) => void;
  onLogout: () => void;
}) {
  const lock = useLockTill();

  const [storeUsername] = useState<string>(
    () => getCachedStoreUsernameForStoreId(user.storeId) ?? user.username,
  );
  const [pinSet, setPinSet] = useState<boolean>(() =>
    hasPin(
      getCachedStoreUsernameForStoreId(user.storeId) ?? user.username,
      user.username,
    ),
  );
  const [settingPin, setSettingPin] = useState(false);

  const handleSavePin = useCallback(
    (pin: string): string | null => {
      if (!storeUsername) return "No account to set a PIN for.";
      const result = setPin(storeUsername, user.username, pin);
      if (!result.ok) {
        if (result.error === "weak")
          return "That PIN is too easy to guess. Pick another.";
        if (result.error === "malformed") return "A PIN is four digits.";
        // No cached credential means nothing for the PIN to unlock. It happens
        // when the cache was cleared after sign-in; signing in again fixes it.
        return "Sign in with your password once more, then set a PIN.";
      }
      logActivity("auth.pin_set", { target: user.displayName });
      toast.success("PIN updated");
      setPinSet(true);
      setSettingPin(false);
      return null;
    },
    [user, storeUsername],
  );

  const handleClearPin = useCallback(() => {
    if (!storeUsername) return;
    clearPin(storeUsername, user.username);
    logActivity("auth.pin_cleared", { target: user.displayName });
    setPinSet(false);
    toast.success("PIN removed — you will use your password");
  }, [user, storeUsername]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-[15px] font-bold text-primary">
            {initialsFor(user.displayName || user.username)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[16px] font-bold">
              {user.displayName || user.username}
            </span>
            <span className="block text-[12px] font-medium text-muted-foreground">
              {user.isOwner ? "Store owner" : "Employee"}
            </span>
          </span>
        </DialogTitle>
        <DialogDescription className="sr-only">
          Account, PIN and session controls
        </DialogDescription>
      </DialogHeader>

      {settingPin ? (
        <div className="flex min-h-[26rem] flex-col">
          <PinSetupCard
            displayName={user.displayName || user.username}
            onSave={handleSavePin}
            onSkip={() => setSettingPin(false)}
            skipLabel="Cancel"
            title={pinSet ? "Change your PIN" : "Set a quick PIN"}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-muted/30 px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <StoreIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Store
              </span>
              <span className="block truncate text-[14px] font-semibold">
                {storeUsername}
              </span>
            </span>
          </div>

          <Row
            icon={<Lock className="h-4 w-4" />}
            label="Lock the till"
            hint="Keeps the cart, the lanes and the open shift"
            onClick={() => {
              onOpenChange(false);
              lock();
            }}
          />

          <Row
            icon={<KeyRound className="h-4 w-4" />}
            label={pinSet ? "Change PIN" : "Set a PIN"}
            hint={
              pinSet
                ? "Four digits to unlock this device"
                : "Skip the password on this device"
            }
            onClick={() => setSettingPin(true)}
          />

          {pinSet && (
            <Row
              icon={<Trash2 className="h-4 w-4" />}
              label="Remove PIN"
              hint="You will sign in with your password"
              tone="destructive"
              onClick={handleClearPin}
            />
          )}

          <Row
            icon={<LogOut className="h-4 w-4" />}
            label="Log out"
            hint="Ends the session on this device"
            tone="destructive"
            onClick={() => {
              onOpenChange(false);
              onLogout();
            }}
          />
        </div>
      )}
    </>
  );
}

export default AccountDialog;
