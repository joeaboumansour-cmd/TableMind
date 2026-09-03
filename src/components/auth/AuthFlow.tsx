"use client";

// =============================================
// AuthFlow — the roster / PIN / password state machine.
//
// ONE implementation, two hosts: the login page and the lock overlay. They
// differ only in their chrome and in what "authenticated" means afterwards
// (navigate to the landing route, versus lift an overlay off a session that
// never went away). Copying this into both is how the two would drift into
// disagreeing about who can get in, which is the last thing an auth surface
// should do.
//
//   roster   -> pin        (tap a face, four digits)
//   roster   -> password   ("Other", or nobody has a PIN on this device)
//   password -> pin-setup  (offered once, skippable)
// =============================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  getRosterForStore,
  getRosterEntry,
  getMostRecentCachedEntry,
  getCachedStoreUsernames,
  forgetCachedEntry,
  setPin,
  shouldOfferPinSetup,
  markPinPromptDismissed,
  type RosterEntry,
} from "@/lib/auth/offlineAuth";
import { PIN_MAX_ATTEMPTS, type PinVerdict } from "@/lib/auth/pinPolicy";
import { connectivity } from "@/lib/connectivity";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { primeFeedback, playSuccessSound } from "@/lib/feedback";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import StoreChip from "./StoreChip";
import StorePicker from "./StorePicker";
import RosterGrid from "./RosterGrid";
import PinPad from "./PinPad";
import PasswordForm from "./PasswordForm";
import PinSetupCard from "./PinSetupCard";

type Stage = "store" | "roster" | "pin" | "password" | "pin-setup";

export interface AuthFlowProps {
  /**
   * "lock" pre-selects whoever locked the till and never offers to forget them;
   * "login" starts on the roster.
   */
  mode: "login" | "lock";
  lockedStoreUsername?: string;
  lockedUsername?: string;
  /** Fired once the session is live and any PIN offer has been dealt with. */
  onAuthenticated: () => void;
  /** Lock mode only: the way out for someone who is not coming back. */
  onSignOut?: () => void;
  className?: string;
}

/** mm:ss from a deadline. Always recomputed — never decremented. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthFlow({
  mode,
  lockedStoreUsername,
  lockedUsername,
  onAuthenticated,
  onSignOut,
  className,
}: AuthFlowProps) {
  const { login, loginOffline, unlockWithPin } = useAuth();
  // The one BEHAVIOURAL desktop branch on this screen: autofocus the first
  // field. On a phone that raises the software keyboard over everything
  // before the cashier has decided what they are doing; on a till with a
  // keyboard and no touchscreen, not focusing it means reaching for a mouse.
  const isDesktop = useIsDesktop();

  const [storeUsername, setStoreUsername] = useState("");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [knownStores, setKnownStores] = useState<string[]>([]);
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [stage, setStage] = useState<Stage>("roster");
  const [manageMode, setManageMode] = useState(false);

  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [pinTone, setPinTone] = useState<"error" | "muted">("muted");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The store in force when the picker was opened, so Cancel can UNDO rather
  // than leave you wherever the picker happened to put you. "Another store"
  // clears the store and the roster on purpose, and without this a cancel from
  // there dropped the cashier into the very form they were backing out of.
  const storeBeforeChange = useRef<string>("");

  // Who the pin-setup offer is for, once a password sign-in has landed.
  const pendingSetup = useRef<{
    storeUsername: string;
    username: string;
    displayName: string;
  } | null>(null);

  const refreshRoster = useCallback((store: string) => {
    setRoster(store ? getRosterForStore(store) : []);
  }, []);

  // ---- Bootstrap: which store is this till in, and who does it know? ----
  useEffect(() => {
    const store =
      lockedStoreUsername || getMostRecentCachedEntry()?.storeUsername || "";
    setStoreUsername(store);
    setKnownStores(getCachedStoreUsernames());
    refreshRoster(store);

    if (!store) {
      // A brand-new till knows nothing. Straight to the full form.
      setStage("password");
      return;
    }

    if (mode === "lock" && lockedUsername) {
      const entry = getRosterForStore(store).find(
        (e) => e.username === lockedUsername
      );
      if (entry) {
        setSelected(entry);
        setUsername(entry.username);
        // Someone with no PIN still types their password to get back in —
        // locking is not a way to bypass the credential.
        setStage(entry.hasPin ? "pin" : "password");
      }
    }
  }, [mode, lockedStoreUsername, lockedUsername, refreshRoster]);

  // The audio context has to be unlocked by a real gesture, or the first sound
  // of the session is swallowed by the autoplay policy.
  useEffect(() => {
    const prime = () => primeFeedback();
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", prime, opts);
    window.addEventListener("keydown", prime, opts);
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // ---- Cooldown ticker ----
  //
  // Recomputed from the DEADLINE every second rather than decremented: a
  // decrementing interval freezes while the tab is backgrounded and comes back
  // claiming more time is left than actually is.
  useEffect(() => {
    if (!cooldownUntil) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const cooling = Boolean(cooldownUntil && cooldownUntil > now);

  useEffect(() => {
    if (cooldownUntil && cooldownUntil <= now) {
      setCooldownUntil(null);
      setPinMessage(null);
      setPinTone("muted");
    }
  }, [cooldownUntil, now]);

  const cooldownMessage = useMemo(() => {
    if (!cooling || !cooldownUntil) return null;
    return `Too many wrong PINs. Try again in ${formatCountdown(cooldownUntil - now)}`;
  }, [cooling, cooldownUntil, now]);

  // ---- Selecting a person ----
  const handleSelect = useCallback((entry: RosterEntry) => {
    setSelected(entry);
    setUsername(entry.username);
    setPinMessage(null);
    setPinTone("muted");
    setCooldownUntil(
      entry.pinLockedUntil && entry.pinLockedUntil > Date.now()
        ? entry.pinLockedUntil
        : null
    );
    // No PIN on this device means the password is the only route. Sending them
    // to a pad that cannot let them in would be a dead end.
    setStage(entry.hasPin ? "pin" : "password");
  }, []);

  const handleOther = useCallback(() => {
    setSelected(null);
    setUsername("");
    setStage("password");
  }, []);

  const handleForget = useCallback(
    (entry: RosterEntry) => {
      forgetCachedEntry(entry.storeUsername, entry.username);
      refreshRoster(storeUsername);
      toast.success(`${entry.displayName} removed from this device`);
    },
    [refreshRoster, storeUsername]
  );

  // ---- PIN ----
  const describeVerdict = useCallback((verdict: PinVerdict): string => {
    if (verdict.ok) return "";
    switch (verdict.reason) {
      case "no_entry":
        return "This device does not know that account. Use your password.";
      case "no_pin":
        return "No PIN set on this device. Use your password.";
      case "cooldown":
        return `Too many wrong PINs. Try again in ${formatCountdown(verdict.retryAfterMs)}`;
      case "wrong":
        // Silent about the count for the first couple of misses. One fat finger
        // is not worth an alarm, and counting down from five simply teaches
        // people to expect to be locked out.
        return verdict.attemptsRemaining <= PIN_MAX_ATTEMPTS - 3
          ? `Wrong PIN — ${verdict.attemptsRemaining} ${
              verdict.attemptsRemaining === 1 ? "try" : "tries"
            } left`
          : "Wrong PIN";
    }
  }, []);

  const handlePinSubmit = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!selected) return false;
      const result = await unlockWithPin(
        selected.storeUsername,
        selected.username,
        pin
      );

      if (result.success) {
        playSuccessSound();
        onAuthenticated();
        return true;
      }

      setPinTone("error");
      setPinMessage(describeVerdict(result.verdict));

      const verdict = result.verdict;
      if (verdict.ok === false) {
        if (verdict.reason === "cooldown") {
          setCooldownUntil(Date.now() + verdict.retryAfterMs);
        } else if (verdict.reason === "wrong" && verdict.lockedUntil) {
          setCooldownUntil(verdict.lockedUntil);
        } else if (verdict.reason === "no_pin" || verdict.reason === "no_entry") {
          // Nothing on this device to check against — the pad cannot help.
          setStage("password");
        }
      }
      return false;
    },
    [selected, unlockWithPin, onAuthenticated, describeVerdict]
  );

  // ---- Password ----
  const finish = useCallback(
    (store: string, who: string) => {
      if (shouldOfferPinSetup(store, who)) {
        pendingSetup.current = {
          storeUsername: store,
          username: who,
          // Read back from the cache the login just refreshed, so the offer
          // addresses "Karim Aoun" rather than the `karim` they typed. The
          // display name only exists on the credential the server returned.
          displayName: getRosterEntry(store, who)?.displayName || who,
        };
        setStage("pin-setup");
        return;
      }
      onAuthenticated();
    },
    [onAuthenticated]
  );

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      const store = storeUsername.trim();
      const who = username.trim();
      if (!store || !who || !password) {
        toast.error("Fill in every field");
        return;
      }

      setIsSubmitting(true);
      try {
        // The heartbeat, not navigator.onLine — a connected wifi with no
        // internet reports itself online and would send us down the wrong
        // branch with no way back.
        const result = connectivity.isOnline
          ? await login(store, who, password)
          : await loginOffline(store, password, who);

        if (!result.success) {
          toast.error(result.error || "Invalid username or password");
          return;
        }

        playSuccessSound();
        refreshRoster(store);
        // Signing into a shop this device had never seen adds it to the list
        // the picker offers next time.
        setKnownStores(getCachedStoreUsernames());
        finish(store, who);
      } finally {
        setIsSubmitting(false);
      }
    },
    [storeUsername, username, login, loginOffline, refreshRoster, finish]
  );

  // ---- PIN setup ----
  const handleSavePin = useCallback(
    (pin: string): string | null => {
      const target = pendingSetup.current;
      if (!target) return "Something went wrong. Skip for now.";
      const result = setPin(target.storeUsername, target.username, pin);
      if (!result.ok) {
        if (result.error === "weak")
          return "That PIN is too easy to guess. Pick another.";
        if (result.error === "malformed") return "A PIN is four digits.";
        return "This device cannot store a PIN for that account.";
      }
      toast.success("PIN set — tap your name next time");
      onAuthenticated();
      return null;
    },
    [onAuthenticated]
  );

  const handleSkipPin = useCallback(() => {
    const target = pendingSetup.current;
    if (target) markPinPromptDismissed(target.storeUsername, target.username);
    onAuthenticated();
  }, [onAuthenticated]);

  // ---- Render ----
  const showStoreChip =
    Boolean(storeUsername) && stage !== "pin-setup" && stage !== "store";
  const canChangeStore =
    mode === "login" && stage !== "pin-setup" && knownStores.length > 0;

  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col", className)}>
      {showStoreChip && (
        <div className="px-5 pb-3">
          <StoreChip
            storeUsername={storeUsername}
            // Goes to the PICKER, not straight to the password form.
            // It used to set stage="password" while leaving storeUsername
            // set — and PasswordForm hides the store field precisely when the
            // device already knows the store, so "Change" landed you on the
            // same two fields with no way to name a different shop. It looked
            // like a dead button.
            onChange={
              canChangeStore
                ? () => {
                    storeBeforeChange.current = storeUsername;
                    setStage("store");
                  }
                : undefined
            }
          />
        </div>
      )}

      {stage === "store" && (
        <StorePicker
          stores={knownStores}
          current={storeUsername}
          countFor={(store) => getRosterForStore(store).length}
          onPick={(store) => {
            setStoreUsername(store);
            refreshRoster(store);
            setSelected(null);
            setUsername("");
            setPinMessage(null);
            setCooldownUntil(null);
            setStage("roster");
          }}
          onOther={() => {
            // Clearing the store is what makes PasswordForm show its store
            // field again, and empties the roster so the old shop's staff are
            // not offered under a new one.
            setStoreUsername("");
            setRoster([]);
            setSelected(null);
            setUsername("");
            setStage("password");
          }}
          onCancel={() => {
            const previous = storeBeforeChange.current;
            if (!previous) {
              setStage("password");
              return;
            }
            setStoreUsername(previous);
            const restored = getRosterForStore(previous);
            setRoster(restored);
            setSelected(null);
            setUsername("");
            setStage(restored.length > 0 ? "roster" : "password");
          }}
        />
      )}

      {stage === "roster" && (
        <div className="flex min-h-0 flex-1 flex-col justify-center px-3 pb-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Who is on the till?
            </p>
            {roster.length > 0 && mode === "login" && (
              <button
                type="button"
                onClick={() => setManageMode((v) => !v)}
                className="tap rounded-lg px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
              >
                {manageMode ? "Done" : "Manage"}
              </button>
            )}
          </div>
          <RosterGrid
            roster={roster}
            selectedUsername={selected?.username ?? null}
            onSelect={handleSelect}
            onOther={handleOther}
            onForget={handleForget}
            manageMode={manageMode}
          />
        </div>
      )}

      {stage === "pin" && selected && (
        <PinPad
          // Keyed on the person, so switching who is signing in remounts the
          // pad with empty dots rather than carrying their digits across.
          key={selected.username}
          displayName={selected.displayName}
          onSubmit={handlePinSubmit}
          onCancel={() => {
            setPinMessage(null);
            setPinTone("muted");
            setStage(mode === "lock" ? "password" : "roster");
          }}
          onUsePassword={() => setStage("password")}
          message={cooldownMessage ?? pinMessage}
          tone={cooling ? "error" : pinTone}
          disabled={cooling}
        />
      )}

      {stage === "password" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
          <PasswordForm
            storeUsername={storeUsername}
            onStoreUsernameChange={setStoreUsername}
            // Shown only when the device cannot answer it for us. On a till
            // that has been used before, this is the field that disappears.
            showStoreField={!storeUsername || knownStores.length === 0}
            username={username}
            onUsernameChange={setUsername}
            onSubmit={handlePasswordSubmit}
            isSubmitting={isSubmitting}
            autoFocus={isDesktop}
            submitLabel={mode === "lock" ? "Unlock" : "Sign in"}
          />

          <div className="mt-4 flex flex-col items-center gap-1.5">
            {roster.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setStage("roster");
                }}
                className="tap rounded-xl px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/10"
              >
                Back to the list
              </button>
            ) : (
              // Reached by "Another store", which empties the roster on
              // purpose. Without this there is no way back out of the form.
              mode === "login" &&
              knownStores.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStage("store")}
                  className="tap rounded-xl px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/10"
                >
                  Back to the store list
                </button>
              )
            )}
            {mode === "lock" && onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="tap rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:text-destructive"
              >
                Sign out instead
              </button>
            )}
          </div>
        </div>
      )}

      {stage === "pin-setup" && pendingSetup.current && (
        <PinSetupCard
          displayName={pendingSetup.current.displayName}
          onSave={handleSavePin}
          onSkip={handleSkipPin}
        />
      )}
    </div>
  );
}

export default AuthFlow;
