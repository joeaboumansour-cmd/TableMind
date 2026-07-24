"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

interface DayOfWeekData {
  day: string;
  revenue: number;
  transactions: number;
}

interface DayOfWeekChartProps {
  data: DayOfWeekData[];
}

export function DayOfWeekChart({ data }: DayOfWeekChartProps) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 12 }}
          angle={-30}
          textAnchor="end"
          height={80}
        />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip
          formatter={(value: any, name?: string) => {
            if (name === "Revenue") {
              return [`${value.toLocaleString()} LL`, "Revenue"];
            }
            return [value, name ?? ""];
          }}
        />
        <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}