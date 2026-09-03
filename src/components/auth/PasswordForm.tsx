"use client";

// The full credential path — still here, still the only way a person who is not
// on this device's roster gets in, and the fallback whenever a PIN is cold.
//
// It asks for two fields instead of three when the store is already known,
// which covers every case except first setup on a new till.

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface PasswordFormProps {
  storeUsername: string;
  onStoreUsernameChange: (value: string) => void;
  /** Hide the store field once the device knows which shop it is in. */
  showStoreField: boolean;
  username: string;
  onUsernameChange: (value: string) => void;
  onSubmit: (password: string) => void;
  isSubmitting: boolean;
  /** Focus the first empty field on mount. Desktop only — see the login page. */
  autoFocus?: boolean;
  submitLabel: string;
  className?: string;
}

export function PasswordForm({
  storeUsername,
  onStoreUsernameChange,
  showStoreField,
  username,
  onUsernameChange,
  onSubmit,
  isSubmitting,
  autoFocus = false,
  submitLabel,
  className,
}: PasswordFormProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Never on mobile: focusing a field raises the software keyboard over the
    // rest of the screen before the cashier has decided what they are doing.
    if (autoFocus) firstField.current?.focus();
  }, [autoFocus]);

  return (
    <form
      className={cn("space-y-3.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      {showStoreField && (
        <div className="space-y-1.5">
          <Label htmlFor="storeUsername" className="text-[12px] text-muted-foreground">
            Store username
          </Label>
          <Input
            id="storeUsername"
            ref={firstField}
            value={storeUsername}
            onChange={(e) => onStoreUsernameChange(e.target.value)}
            placeholder="e.g. downtown_store"
            autoComplete="organization"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="username" className="text-[12px] text-muted-foreground">
          Your username
        </Label>
        <Input
          id="username"
          ref={showStoreField ? undefined : firstField}
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="Owners use the store name"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-[12px] text-muted-foreground">
          Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            // `text-base` on Input is load-bearing: anything smaller makes iOS
            // Safari zoom on focus and shove the till out of alignment.
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-11"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(
          "tap flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold transition-colors",
          isSubmitting
            ? "cursor-not-allowed bg-muted/40 text-muted-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSubmitting ? "Signing in…" : submitLabel}
      </button>
    </form>
  );
}

export default PasswordForm;
