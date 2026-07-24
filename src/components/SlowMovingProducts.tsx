"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatLL } from "@/lib/utils/format";

interface SlowMovingProduct {
  product_name: string;
  totalQuantity: number;
  lastSold: string;
  daysSinceLastSale: number;
}

interface SlowMovingProductsProps {
  products: SlowMovingProduct[];
}

export function SlowMovingProducts({ products }: SlowMovingProductsProps) {
  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">
            No slow-moving products detected. Great job!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Slow Moving / Dead Stock</CardTitle>
        <p className="text-sm text-muted-foreground">
          Products with only 1 or fewer sales
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {products.map((product, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex-1">
                <p className="font-medium">{product.product_name}</p>
                <p className="text-sm text-muted-foreground">
                  Qty sold: {product.totalQuantity}
                </p>
              </div>
              <div className="text-right">
                <Badge
                  variant={
                    product.daysSinceLastSale > 30
                      ? "destructive"
                      : product.daysSinceLastSale > 14
                      ? "secondary"
                      : "outline"
                  }
                >
                  {product.lastSold
                    ? `${product.daysSinceLastSale} days ago`
                    : "Never sold"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}