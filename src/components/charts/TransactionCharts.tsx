"use client";

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

interface ProductPerformanceChartProps {
  products: Array<{
    product_name: string;
    totalQuantity: number;
    totalRevenue: number;
  }>;
}

export function ProductPerformanceChart({
  products,
}: ProductPerformanceChartProps) {
  const data = useMemo(() => {
    return products.map((p) => ({
      name: p.product_name.length > 12 ? p.product_name.slice(0, 12) + "…" : p.product_name,
      value: p.totalRevenue,
      quantity: p.totalQuantity,
    }));
  }, [products]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No product data available</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) =>
            `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          outerRadius={80}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip formatter={(value: any) => `${value.toLocaleString()} LL`} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}