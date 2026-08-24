"use client";

// =============================================
// Sales by hour
//
// Replaces HourlySalesHeatmap, which was not a heatmap and was also broken:
// 24 hours were laid into `grid-cols-12`, so the day wrapped onto two rows
// while the axis underneath still read "12 AM ... 6 AM ... 12 PM ... 6 PM ...
// 11 PM" across a single row. The labels described a layout that was not
// there. Bar heights were raw pixels (40px floor, 200px ceiling) rather than
// a scale, and the colour was a hardcoded blue.
//
// The question a shopkeeper asks here is "when is my shop busy?", so the
// answer is stated in words first and the shape of the day supports it.
// One hue: colour is magnitude, and the peak hour keeps full brand weight.
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
import { ChartTooltipBox } from "./ChartTooltip";
import { formatLL, formatLLCompact } from "@/lib/utils/format";

interface HourlySalesData {
  hour: number;
  revenue: number;
  transactions: number;
}

const AXIS = "var(--muted-foreground)";

/** 14 -> "2 PM". Shop hours read as clock time, not as 24-hour indices. */
function clockLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

export function HourlySalesChart({ data }: { data: HourlySalesData[] }) {
  const total = data.reduce((sum, d) => sum + d.revenue, 0);
  if (total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No sales in this range.
      </p>
    );
  }

  const peak = data.reduce((best, d) => (d.revenue > best.revenue ? d : best), data[0]);

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Busiest at{" "}
        <span className="font-semibold text-foreground">{clockLabel(peak.hour)}</span>{" "}
        <span className="tnum">({formatLL(peak.revenue)})</span>
      </p>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid
            vertical={false}
            stroke="currentColor"
            className="text-white/[0.06]"
          />
          <XAxis
            dataKey="hour"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: AXIS }}
            // Every third hour. 24 labels along this width collide into a
            // grey smear; 8 of them still let you find the time of day.
            ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
            tickFormatter={clockLabel}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={46}
            tick={{ fontSize: 11, fill: AXIS }}
            tickFormatter={formatLLCompact}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as HourlySalesData;
              return (
                <ChartTooltipBox
                  title={clockLabel(d.hour)}
                  rows={[
                    { label: "Revenue", value: formatLL(d.revenue) },
                    { label: "Sales", value: String(d.transactions) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.hour}
                className={d.hour === peak.hour ? "fill-primary" : "fill-primary/55"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
