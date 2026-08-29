"use client";

// =============================================
// Register performance
//
// Answers "which drawer is carrying the shop?" — a question that was not
// answerable before migration 027, because every sale looked like it belonged
// to the whole store.
//
// The headline is stated in words before any chart, following the house style
// set by HourlySalesChart: the shopkeeper should get the answer without having
// to read a bar. One hue, magnitude is the only thing colour encodes, and the
// leading register keeps full brand weight.
//
// recharts is dynamically imported by the parent (it is ~90KB and this is not
// the till's hot path). Do not import it statically anywhere reachable from
// /pos.
// =============================================

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltipBox } from "@/components/charts/ChartTooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLL, formatLLCompact, formatPercent } from "@/lib/utils/format";
import { TrendingUp, Crown, AlertTriangle, Clock, Receipt } from "lucide-react";

const AXIS = "var(--muted-foreground)";

export interface RegisterPerformanceRow {
  registerId: string;
  name: string;
  revenue: number;
  transactionCount: number;
  averageBasket: number;
  largestSale: number;
  activeDays: number;
  peakHour: number | null;
  peakHourTransactions: number;
  shiftsClosed: number;
  hoursOpen: number;
  salesPerHour: number | null;
  revenuePerHour: number | null;
  shareOfRevenue: number;
  cumulativeVariance: number | null;
}

/** 14 -> "2 PM". Shop hours read as clock time, not 24-hour indices. */
function clockLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p
        className={`tnum mt-1 font-semibold ${
          tone === "warn" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function RegisterPerformance({
  registers,
  storeRevenue,
  busiestRegisterId,
  rangeLabel,
}: {
  registers: RegisterPerformanceRow[];
  storeRevenue: number;
  busiestRegisterId: string | null;
  rangeLabel: string;
}) {
  const withSales = registers.filter((r) => r.transactionCount > 0);

  if (withSales.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Register performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No sales attributed to a register {rangeLabel}. If tills are selling, check that each
            device has a register selected.
          </p>
        </CardContent>
      </Card>
    );
  }

  const busiest = withSales.find((r) => r.registerId === busiestRegisterId) || withSales[0];
  const chartData = withSales.map((r) => ({
    name: r.name,
    revenue: r.revenue,
    id: r.registerId,
  }));

  // Worst reconciliation record — the register most worth asking about.
  const worstVariance = withSales.reduce<RegisterPerformanceRow | null>((worst, r) => {
    if (r.cumulativeVariance === null) return worst;
    if (worst === null || worst.cumulativeVariance === null) return r;
    return Math.abs(r.cumulativeVariance) > Math.abs(worst.cumulativeVariance) ? r : worst;
  }, null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Register performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── The answer, in words ─────────────────────────────────────── */}
        <div>
          <p className="text-sm">
            <span className="font-semibold">{busiest.name}</span> is the busiest register{" "}
            {rangeLabel} — {formatLL(busiest.revenue)}
            {withSales.length > 1 && (
              <>
                , {formatPercent(busiest.shareOfRevenue, 0)} of takings across{" "}
                {withSales.length} registers
              </>
            )}
            .
          </p>
          {worstVariance &&
            worstVariance.cumulativeVariance !== null &&
            Math.abs(worstVariance.cumulativeVariance) > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>
                  <span className="font-medium text-destructive">{worstVariance.name}</span> is
                  cumulatively{" "}
                  {worstVariance.cumulativeVariance > 0 ? "over" : "short"} by{" "}
                  {formatLL(Math.abs(worstVariance.cumulativeVariance))} across{" "}
                  {worstVariance.shiftsClosed} counted shift
                  {worstVariance.shiftsClosed !== 1 ? "s" : ""}.
                </span>
              </p>
            )}
        </div>

        {/* ── Takings by register ──────────────────────────────────────── */}
        {withSales.length > 1 && (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: AXIS, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatLLCompact(v)}
                  tick={{ fill: AXIS, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = withSales.find((r) => r.registerId === payload[0].payload.id);
                    if (!row) return null;
                    return (
                      <ChartTooltipBox
                        title={row.name}
                        rows={[
                          { label: "Takings", value: formatLL(row.revenue) },
                          { label: "Sales", value: String(row.transactionCount) },
                          { label: "Avg basket", value: formatLL(row.averageBasket) },
                          { label: "Share", value: formatPercent(row.shareOfRevenue, 0) },
                        ]}
                      />
                    );
                  }}
                />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.id}
                      fill="var(--primary)"
                      fillOpacity={d.id === busiest.registerId ? 1 : 0.45}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Per-register detail ──────────────────────────────────────── */}
        <div className="space-y-4">
          {withSales.map((r) => (
            <div key={r.registerId}>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-sm font-semibold">{r.name}</h4>
                {r.registerId === busiest.registerId && withSales.length > 1 && (
                  <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                    <Crown className="h-3 w-3" />
                    Busiest
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile
                  icon={TrendingUp}
                  label="Takings"
                  value={formatLL(r.revenue)}
                  // "of registers", not "of store". The denominator is the sum
                  // of what the REGISTERS took; sales that reached no drawer are
                  // not in it. Calling a register's slice of that "100% of
                  // store" told a shop with unassigned takings that it had seen
                  // all its money, which is exactly backwards.
                  hint={
                    storeRevenue > 0
                      ? `${formatPercent(r.shareOfRevenue, 0)} of registers`
                      : undefined
                  }
                />
                <MetricTile
                  icon={Receipt}
                  label="Sales"
                  value={String(r.transactionCount)}
                  hint={`avg ${formatLL(r.averageBasket)}`}
                />
                <MetricTile
                  icon={Clock}
                  label="Busiest hour"
                  value={r.peakHour !== null ? clockLabel(r.peakHour) : "—"}
                  hint={
                    r.peakHourTransactions > 0
                      ? `${r.peakHourTransactions} sale${r.peakHourTransactions !== 1 ? "s" : ""}`
                      : undefined
                  }
                />
                <MetricTile
                  icon={TrendingUp}
                  label="Throughput"
                  value={r.salesPerHour !== null ? `${r.salesPerHour.toFixed(1)} sales/h` : "—"}
                  // formatLLCompact drops the "LL" on purpose — it exists for
                  // chart axis ticks. Used bare here it read as "404/h" sitting
                  // under "0.0/h", two different quantities wearing the same
                  // suffix and one of them with no unit at all.
                  hint={
                    r.revenuePerHour !== null
                      ? `${formatLLCompact(r.revenuePerHour)} LL/h`
                      : "no closed shifts yet"
                  }
                />
              </div>

              {/* Reconciliation record: only shifts that were actually counted
                  can contribute. An open shift is unknown, not balanced. */}
              {r.shiftsClosed > 0 && r.cumulativeVariance !== null && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    {r.shiftsClosed} shift{r.shiftsClosed !== 1 ? "s" : ""} counted · largest sale{" "}
                    {formatLL(r.largestSale)}
                  </span>
                  <span
                    className={`tnum font-semibold ${
                      r.cumulativeVariance === 0
                        ? "text-muted-foreground"
                        : r.cumulativeVariance > 0
                          ? "text-emerald-500"
                          : "text-destructive"
                    }`}
                  >
                    {r.cumulativeVariance === 0
                      ? "Balanced"
                      : `${r.cumulativeVariance > 0 ? "+" : ""}${formatLL(r.cumulativeVariance)}`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
