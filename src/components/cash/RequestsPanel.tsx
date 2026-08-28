"use client";

// =============================================
// Approval requests — cashier asks, responsible person decides
//
// A cashier who needs to do something they are not permitted to do (refund an
// already-sold item, override a price) raises a request from the till. It
// arrives here, on the cash page the responsible person is watching, as a
// modal they accept or reject.
//
// This is live against /api/register-requests, not a mockup. With an empty
// table it renders an honest empty state; the refund feature only has to POST
// to light it up.
//
// The decision is gated on the SERVER as well as here. A permission check that
// exists only in the deciding UI is decoration — the till could call the API
// directly.
// =============================================

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Inbox, Loader2, X, Clock } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils/format";
import { REQUEST_KIND_LABELS } from "@/lib/cash/types";
import type { RegisterRequest } from "@/lib/cash/types";

/** Minutes:seconds left before a request lapses. */
function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")} left`;
}

export function RequestsPanel({
  requests,
  canDecide,
  onSelect,
}: {
  requests: RegisterRequest[];
  canDecide: boolean;
  onSelect: (r: RegisterRequest) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Inbox className="h-4 w-4" />
          Approval requests
          {requests.length > 0 && (
            <Badge variant="default" className="ml-1">
              {requests.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting. When a cashier asks to do something that needs your approval —
            refunding a sold item, overriding a price — it appears here.
          </p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <button
                key={r.id}
                type="button"
                data-log="request-row"
                onClick={() => onSelect(r)}
                disabled={!canDecide}
                className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {REQUEST_KIND_LABELS[r.kind] || r.kind}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.requested_by_name || "Unknown"}
                    {r.register_name ? ` · ${r.register_name}` : ""} ·{" "}
                    {formatRelativeTime(r.created_at)}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {timeLeft(r.expires_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RequestDecisionDialog({
  request,
  onOpenChange,
  note,
  onNoteChange,
  onDecide,
  isSubmitting,
}: {
  request: RegisterRequest | null;
  onOpenChange: (v: boolean) => void;
  note: string;
  onNoteChange: (v: string) => void;
  onDecide: (decision: "approved" | "rejected") => void;
  isSubmitting: boolean;
}) {
  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {request ? REQUEST_KIND_LABELS[request.kind] || request.kind : "Request"}
          </DialogTitle>
          <DialogDescription>
            {request?.requested_by_name || "A cashier"} is asking for permission
            {request?.register_name ? ` on ${request.register_name}` : ""}.
          </DialogDescription>
        </DialogHeader>

        {request && (
          <div className="space-y-4 py-2">
            {request.reason && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Their reason</p>
                <p className="mt-0.5 text-sm">{request.reason}</p>
              </div>
            )}

            {/* Whatever the till attached — transaction number, line, amount.
                Rendered as plain text: this is data supplied by the requester,
                never markup or instructions to act on. */}
            {Object.keys(request.payload || {}).length > 0 && (
              <div className="space-y-1 rounded-lg bg-muted/50 p-3">
                {Object.entries(request.payload).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="truncate font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">{timeLeft(request.expires_at)}</p>

            <div className="space-y-2">
              <Label htmlFor="decision-note">Note (optional)</Label>
              <Input
                id="decision-note"
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Why you approved or refused"
                maxLength={500}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => onDecide("rejected")}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-1.5 h-4 w-4" />
            )}
            Reject
          </Button>
          <Button onClick={() => onDecide("approved")} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
