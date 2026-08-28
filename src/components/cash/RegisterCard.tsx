"use client";

// =============================================
// One register on the cash page
//
// The card answers, in this order: is this drawer running, whose it is, how
// long it has been open, and what should be inside it.
//
// The overdue state is the reason this component exists in the shape it does.
// A shift left open across midnight used to vanish from the screen — the page
// asked for today's date, got nothing, and showed "No Shift Open" over a drawer
// that was still open with uncounted cash in it. Here it does the opposite: it
// becomes the loudest thing on the page and stays that way until somebody
// counts it. Nothing closes it automatically, because a closing figure is a
// physical count and inventing one destroys the variance it was meant to catch.
// =============================================

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Banknote,
  Check,
  Clock,
  Lock,
  User,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Inbox,
  Trash2,
} from "lucide-react";
import { formatLL, formatUSD, formatDateTime } from "@/lib/utils/format";
import { isOverdue, shiftAgeHours } from "@/lib/cash/types";
import type { RegisterState } from "@/lib/cash/types";

interface RegisterCardProps {
  state: RegisterState;
  canEdit: boolean;
  isOwner: boolean;
  onOpenShift: () => void;
  onCloseShift: () => void;
  onAddAdjustment: () => void;
  onViewRequests: () => void;
  onRemove: () => void;
}

export function RegisterCard({
  state,
  canEdit,
  isOwner,
  onOpenShift,
  onCloseShift,
  onAddAdjustment,
  onViewRequests,
  onRemove,
}: RegisterCardProps) {
  const { register, shift, summary, adjustments, pendingRequestCount } = state;

  const isOpen = shift?.status === "open";
  const overdue = isOverdue(shift);
  const hoursOpen = shiftAgeHours(shift);

  return (
    <Card className={overdue ? "border-destructive/60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold">{register.name}</h3>

              {isOpen ? (
                <Badge
                  variant={overdue ? "destructive" : "default"}
                  className={overdue ? undefined : "bg-emerald-600 hover:bg-emerald-600"}
                >
                  {overdue ? "Needs counting" : "Open"}
                </Badge>
              ) : (
                <Badge variant="secondary">Closed</Badge>
              )}

              {isOpen && shift?.assigned_user_name && (
                <Badge variant="outline" className="gap-1">
                  <User className="h-3 w-3" />
                  {shift.assigned_user_name}
                </Badge>
              )}
            </div>

            {shift?.label && (
              <p className="mt-1 truncate text-xs text-muted-foreground">{shift.label}</p>
            )}
          </div>

          {pendingRequestCount > 0 && (
            <button
              type="button"
              onClick={onViewRequests}
              data-log="register-requests-badge"
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/25"
            >
              <Inbox className="h-3.5 w-3.5" />
              {pendingRequestCount} waiting
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ── Overdue banner ─────────────────────────────────────────────── */}
        {overdue && shift && (
          <div className="flex gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-destructive">
                Open since {shift.business_date} · {hoursOpen}h
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This shift was never counted. The cash is still in the drawer — count it and
                close the shift before opening a new one here.
              </p>
            </div>
          </div>
        )}

        {/* An open drawer with nobody on it collects no sales — nothing links a
            cashier to it, so their takings land in the Unassigned bucket. Said
            here rather than left to be discovered at counting time. */}
        {isOpen && !shift?.assigned_user_name && (
          <div className="flex gap-2 rounded-lg bg-muted/60 p-3">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Nobody is assigned to this register. Sales will not be attributed to it until you
              close this shift and reopen it with a cashier named.
            </p>
          </div>
        )}

        {!shift ? (
          <p className="text-sm text-muted-foreground">
            No shift has been opened on this register yet.
          </p>
        ) : (
          <>
            {/* ── Who and when ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Opened by</p>
                <p className="truncate font-medium">{shift.opened_by_name || "Store Owner"}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(shift.opened_at)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Opening float</p>
                <p className="font-semibold">{formatLL(summary?.openingTotal || 0)}</p>
                {shift.opening_usd > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    incl. {formatUSD(shift.opening_usd)}
                  </p>
                )}
              </div>
            </div>

            {/* ── Drawer maths ────────────────────────────────────────────── */}
            {summary && (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Cash from sales
                    {summary.transactionCount > 0 && (
                      <span className="ml-1 text-xs">
                        ({summary.transactionCount} sale
                        {summary.transactionCount !== 1 ? "s" : ""})
                      </span>
                    )}
                  </span>
                  <span className="tnum">{formatLL(summary.cashReceived)}</span>
                </div>

                {summary.adjustmentsIn > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash in</span>
                    <span className="tnum text-emerald-500">
                      +{formatLL(summary.adjustmentsIn)}
                    </span>
                  </div>
                )}
                {summary.adjustmentsOut > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash out</span>
                    <span className="tnum text-destructive">
                      -{formatLL(summary.adjustmentsOut)}
                    </span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between font-semibold">
                  <span>Expected in drawer</span>
                  <span className="tnum">{formatLL(summary.expectedTotal)}</span>
                </div>

                {/* ── Variance, once counted ──────────────────────────────── */}
                {summary.variance !== null && (
                  <div
                    className={`mt-2 rounded-lg p-3 ${
                      summary.variance === 0
                        ? "bg-muted/50"
                        : summary.variance > 0
                          ? "bg-emerald-500/10"
                          : "bg-destructive/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p
                          className={`font-semibold ${
                            summary.variance === 0
                              ? "text-foreground"
                              : summary.variance > 0
                                ? "text-emerald-500"
                                : "text-destructive"
                          }`}
                        >
                          {summary.variance === 0
                            ? "Balanced"
                            : summary.variance > 0
                              ? "Overage"
                              : "Shortage"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Counted {formatLL(summary.closingTotal || 0)}
                        </p>
                      </div>
                      <span
                        className={`tnum text-lg font-bold ${
                          summary.variance === 0
                            ? "text-foreground"
                            : summary.variance > 0
                              ? "text-emerald-500"
                              : "text-destructive"
                        }`}
                      >
                        {summary.variance > 0 ? "+" : ""}
                        {formatLL(summary.variance)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Adjustments ─────────────────────────────────────────────── */}
            {adjustments.length > 0 && (
              <div className="space-y-1">
                {adjustments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
                  >
                    {a.adjustment_type === "cash_in" ? (
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {a.reason}
                    </span>
                    <span className="tnum shrink-0">{formatLL(a.amount_ll)}</span>
                  </div>
                ))}
              </div>
            )}

            {shift.status === "closed" && (
              <p className="text-xs text-muted-foreground">
                Closed by {shift.closed_by_name || "Store Owner"}
                {shift.closed_at ? ` · ${formatDateTime(shift.closed_at)}` : ""}
              </p>
            )}
          </>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 pt-1">
          {canEdit ? (
            isOpen ? (
              <>
                <Button size="sm" onClick={onCloseShift}>
                  <Check className="mr-1.5 h-4 w-4" />
                  Count &amp; close
                </Button>
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={onAddAdjustment}>
                    <Banknote className="mr-1.5 h-4 w-4" />
                    Cash in/out
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" onClick={onOpenShift}>
                  <Banknote className="mr-1.5 h-4 w-4" />
                  Open shift
                </Button>
                {/* Only offered when nothing is open here. A drawer with money
                    in it is counted before it can be removed. */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRemove}
                  className="text-muted-foreground hover:text-destructive"
                  data-log="remove-register"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Remove
                </Button>
              </>
            )
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              You do not have permission to open or close shifts.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
