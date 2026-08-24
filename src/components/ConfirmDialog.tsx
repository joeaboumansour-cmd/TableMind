"use client";

// =============================================
// Confirm dialog with a cooldown
//
// Destructive actions in the POS used to sit behind `window.confirm()`, which
// is a native modal whose default button is one Enter-press away — on a phone
// it is a grey system sheet that a cashier dismisses by reflex. Deleting a
// product, signing a till out, or wiping every product on a CSV replace are
// all one careless tap from happening.
//
// So: a real dialog, and the confirm button stays DISABLED for a few seconds
// with a visible timer. The delay is the point — it costs five seconds on an
// action that should be rare, and it breaks the muscle memory that makes
// accidental deletes possible in the first place.
//
// The countdown is deadline-based rather than a naive `setInterval` decrement,
// because interval timers are throttled hard in a backgrounded tab: a cashier
// who switches apps mid-dialog would come back to a counter frozen at 4.
//
// Two ways to use it:
//   - <ConfirmDialog open … onConfirm />        for a dialog you already own
//   - const { confirm, confirmDialog } = useConfirm()
//     …  if (!(await confirm({ title: … }))) return;
//     for the `if (!confirm(…)) return;` shape, inside async handlers.
// =============================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Cooldown applied to every destructive confirm unless a caller overrides it. */
export const CONFIRM_COUNTDOWN_SECONDS = 5;

/** How often the countdown recomputes. Fine enough for a smooth progress bar. */
const TICK_MS = 100;

export type ConfirmDialogOptions = {
  title: string;
  /** Sub-heading. Say what happens, and whether it can be undone. */
  description?: ReactNode;
  /** Optional block between the description and the buttons (amounts, counts). */
  details?: ReactNode;
  /** Icon shown on the confirm button once the cooldown has elapsed. */
  confirmIcon?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Set 0 to confirm immediately. Defaults to CONFIRM_COUNTDOWN_SECONDS. */
  countdownSeconds?: number;
  /** Confirm button styling. Destructive unless the action is merely irreversible. */
  variant?: "destructive" | "default";
};

type ConfirmDialogProps = ConfirmDialogOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  details,
  confirmIcon,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  countdownSeconds = CONFIRM_COUNTDOWN_SECONDS,
  variant = "destructive",
}: ConfirmDialogProps) {
  const totalMs = Math.max(0, countdownSeconds) * 1000;
  const [remainingMs, setRemainingMs] = useState(totalMs);

  useEffect(() => {
    if (!open) return;

    // Restarting the clock on every open is the whole guarantee of this
    // component, and it has to happen for a reused instance too — Radix keeps
    // the content mounted through its exit animation, so a close-then-reopen
    // inside that window would otherwise inherit an already-elapsed timer and
    // hand back an armed Delete button. One extra render when a modal opens is
    // a fair price for that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemainingMs(totalMs);
    if (totalMs <= 0) return;

    // Deadline, not a decrementing counter: a throttled or suspended tab then
    // resumes with the correct amount of time already elapsed.
    const deadline = Date.now() + totalMs;
    const id = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left <= 0) clearInterval(id);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [open, totalMs]);

  const locked = remainingMs > 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const barColor = variant === "destructive" ? "bg-destructive" : "bg-primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {details ? <div className="text-sm">{details}</div> : null}

        {/* Drains left-to-right so the wait reads as progress, not a hang. */}
        {locked && (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full ${barColor} transition-[width] duration-100 ease-linear`}
              style={{ width: `${(remainingMs / totalMs) * 100}%` }}
            />
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            className="h-12 flex-1 rounded-2xl"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            disabled={locked}
            className="h-12 flex-1 rounded-2xl font-bold"
            onClick={onConfirm}
          >
            {locked ? (
              <span role="timer" aria-live="off" className="tnum">
                {confirmLabel} in {secondsLeft}s
              </span>
            ) : (
              <>
                {confirmIcon}
                {confirmLabel}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmRequest = {
  id: number;
  open: boolean;
  options: ConfirmDialogOptions;
};

/**
 * Promise-based confirm, for handlers shaped like the old
 * `if (!confirm(…)) return;`. Render `confirmDialog` anywhere in the screen.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const idRef = useRef(0);

  // Resolve at most once per request: cancelling and confirming both land here,
  // and an unmount mid-dialog must not leave the caller awaiting forever.
  const settle = useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(value);
  }, []);

  const confirm = useCallback(
    (options: ConfirmDialogOptions) => {
      settle(false); // a second request supersedes one still on screen
      idRef.current += 1;
      const id = idRef.current;
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setRequest({ id, open: true, options });
      });
    },
    [settle]
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) settle(false);
      // Kept mounted while closing so the dialog can animate out.
      setRequest((prev) => (prev ? { ...prev, open: next } : prev));
    },
    [settle]
  );

  const handleConfirm = useCallback(() => {
    settle(true);
    setRequest((prev) => (prev ? { ...prev, open: false } : prev));
  }, [settle]);

  useEffect(() => () => settle(false), [settle]);

  const confirmDialog = request ? (
    // Keyed by request: a fresh ask always restarts the cooldown.
    <ConfirmDialog
      key={request.id}
      {...request.options}
      open={request.open}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  ) : null;

  return { confirm, confirmDialog };
}
