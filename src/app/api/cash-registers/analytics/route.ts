// =============================================
// /api/cash-registers/analytics — per-register performance
// =============================================
// "Which drawer is carrying the shop, and which one keeps coming up short."
//
// Only answerable since migration 027 stamped register_id onto transactions.
// Before that every register would have reported the store's whole takings.
//
// The heavy lifting is in get_register_performance(). This route converts its
// raw LL/USD components into the combined figures the UI shows, using the
// shared helpers so the exchange rate has exactly one definition.
// =============================================

import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { callerAndRead } from "@/lib/auth/apiRoute";
import { combineCurrencyTotals, computeExpectedDrawer, computeVariance } from "@/lib/cashShift";

/** Clamp to a sane window so a hand-typed range cannot scan years of sales. */
const MAX_DAYS = 92;

function parseRange(url: URL): { from: Date; to: Date } {
  const to = url.searchParams.get("to");
  const from = url.searchParams.get("from");

  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(toDate.getTime())) toDate.setTime(Date.now());
  // Exclusive upper bound at the end of the "to" day.
  toDate.setHours(23, 59, 59, 999);

  let fromDate = from ? new Date(from) : new Date(toDate);
  if (Number.isNaN(fromDate.getTime())) fromDate = new Date(toDate);
  fromDate.setHours(0, 0, 0, 0);

  const spanDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
  if (spanDays > MAX_DAYS) {
    fromDate = new Date(toDate.getTime() - MAX_DAYS * 86_400_000);
    fromDate.setHours(0, 0, 0, 0);
  }
  if (fromDate > toDate) fromDate = new Date(toDate.getTime() - 86_400_000);

  return { from: fromDate, to: toDate };
}

interface PerfRow {
  register_id: string;
  register_name: string;
  revenue: number;
  txn_count: number;
  avg_basket: number;
  largest_sale: number;
  active_days: number;
  peak_hour: number | null;
  peak_hour_txns: number;
  shifts_closed: number;
  hours_open: number;
  opening_ll: number;
  opening_usd: number;
  closing_ll: number;
  closing_usd: number;
  closed_shift_sales: number;
  adj_in_ll: number;
  adj_in_usd: number;
  adj_out_ll: number;
  adj_out_usd: number;
}

export async function GET(request: Request) {
  try {
    // Range parsing is pure — no I/O — so it happens before the wave.
    const { from, to } = parseRange(new URL(request.url));

    // Auth runs ALONGSIDE the read. The report is scoped to the `store_id` the
    // caller is CLAIMING, so a failed auth discards a read of their own store
    // and nothing is returned before the caller is confirmed.
    const outcome = await callerAndRead(request, (client, storeId) =>
      client.rpc("get_register_performance", {
        p_store_id: storeId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
    );

    if ("error" in outcome) return outcome.error;
    const { data, error } = outcome.result;

    if (error) {
      console.error("Register analytics error:", error.message);
      return NextResponse.json({ error: "Failed to load register performance" }, { status: 500 });
    }

    const rows = (data as PerfRow[]) || [];
    const storeRevenue = rows.reduce((s, r) => s + (r.revenue || 0), 0);

    const registers = rows.map((r) => {
      // Reconstruct the drawer maths from the raw components, through the same
      // helpers the cash page and the close dialog use.
      const openingTotal = combineCurrencyTotals(r.opening_ll, r.opening_usd);
      const closingTotal = combineCurrencyTotals(r.closing_ll, r.closing_usd);
      const adjustmentsIn = combineCurrencyTotals(r.adj_in_ll, r.adj_in_usd);
      const adjustmentsOut = combineCurrencyTotals(r.adj_out_ll, r.adj_out_usd);

      const expected = computeExpectedDrawer({
        openingTotal,
        cashInTotal: r.closed_shift_sales || 0,
        changeOutTotal: 0, // already netted out of closed_shift_sales
        adjustmentsIn,
        adjustmentsOut,
      });

      // Only meaningful once at least one shift has actually been counted.
      const variance = r.shifts_closed > 0 ? computeVariance(closingTotal, expected) : null;

      const hoursOpen = Number(r.hours_open) || 0;

      return {
        registerId: r.register_id,
        name: r.register_name,
        revenue: r.revenue || 0,
        transactionCount: r.txn_count || 0,
        averageBasket: r.avg_basket || 0,
        largestSale: r.largest_sale || 0,
        activeDays: r.active_days || 0,
        peakHour: r.peak_hour,
        peakHourTransactions: r.peak_hour_txns || 0,
        shiftsClosed: r.shifts_closed || 0,
        hoursOpen,
        /** Sales per hour the drawer was actually open — the throughput figure. */
        salesPerHour: hoursOpen > 0 ? (r.txn_count || 0) / hoursOpen : null,
        revenuePerHour: hoursOpen > 0 ? (r.revenue || 0) / hoursOpen : null,
        /** Share of total store takings across all registers, 0–100. */
        shareOfRevenue: storeRevenue > 0 ? ((r.revenue || 0) / storeRevenue) * 100 : 0,
        cumulativeVariance: variance,
      };
    });

    const busiest = registers.reduce<(typeof registers)[number] | null>(
      (best, r) => (best === null || r.revenue > best.revenue ? r : best),
      null
    );

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      storeRevenue,
      storeTransactionCount: registers.reduce((s, r) => s + r.transactionCount, 0),
      busiestRegisterId: busiest?.registerId ?? null,
      registers,
    });
  } catch (error) {
    console.error("Register analytics error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load register performance" }, { status: 500 });
  }
}
