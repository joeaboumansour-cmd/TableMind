"use client";

import { useState, useEffect } from "react";
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

interface HourlySalesData {
  hour: number;
  revenue: number;
  transactions: number;
}

interface HourlySalesHeatmapProps {
  data: HourlySalesData[];
}

export function HourlySalesHeatmap({ data }: HourlySalesHeatmapProps) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-1">
        {data.map((item) => {
          const intensity = item.revenue / maxRevenue;
          const height = Math.max(40, intensity * 200);
          return (
            <div
              key={item.hour}
              className="flex flex-col items-center gap-1"
              title={`${item.hour}:00 - ${item.revenue.toLocaleString()} LL (${item.transactions} txns)`}
            >
              <div
                className="w-full rounded-sm transition-all hover:opacity-80"
                style={{
                  height: `${height}px`,
                  backgroundColor: `rgba(59, 130, 246, ${0.3 + intensity * 0.7})`,
                }}
              />
              <span className="text-xs text-muted-foreground">
                {item.hour.toString().padStart(2, "0")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </div>
  );
}