"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, ChevronLeft, User, Phone, Star, Calendar, AlertCircle } from "lucide-react";
import Link from "next/link";

const supabase = createClient();

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags: string[];
  total_visits: number;
  no_show_count: number;
  cancellation_count: number;
  last_visit_date?: string;
  notes?: string;
  reliability_score?: number;
  food_preferences?: string[];
  dietary_restrictions?: string[];
  birthday?: string;
}

export default function MobileLookupPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data } = await supabase.from("restaurants").select("id").limit(1).single();
      return data?.id || null;
    },
  });

  // Search customers
  const { data: customers = [], isLoading, refetch } = useQuery({
    queryKey: ["mobile-customer-search", searchQuery, restaurantId],
    queryFn: async () => {
      if (!searchQuery.trim() || !restaurantId) return [];
      
      const query = searchQuery.toLowerCase();
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);
      
      return data as Customer[] || [];
    },
    enabled: !!restaurantId && searchQuery.length >= 2,
  });

  const handleSearch = () => {
    if (searchQuery.length >= 2) {
      refetch();
    }
  };

  const getReliabilityColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  const getReliabilityLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 50) return "Fair";
    return "Poor";
  };

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mobile">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Customer Lookup</h1>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-6">
        <Input
          placeholder="Search by name or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="flex-1"
          autoFocus
        />
        <Button onClick={handleSearch} disabled={isLoading}>
          <Search className="h-5 w-5" />
        </Button>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-24" />
            </Card>
          ))}
        </div>
      ) : customers.length === 0 && searchQuery.length >= 2 ? (
        <div className="text-center py-12">
          <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No customers found</p>
          <p className="text-sm text-muted-foreground">Try a different search term</p>
        </div>
      ) : (
        <div className="space-y-3">
          {customers.map((customer) => (
            <Link key={customer.id} href={`/mobile/customer/${customer.id}`}>
              <Card className="cursor-pointer hover:bg-accent transition-colors">
                <CardContent className="p-4">
                  {/* Name & Phone */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-bold text-lg">{customer.name}</h3>
                      <div className="flex items-center gap-1 text-muted-foreground text-sm">
                        <Phone className="h-3 w-3" />
                        {customer.phone}
                      </div>
                    </div>
                    {customer.tags?.includes("VIP") && (
                      <Badge className="bg-amber-500">
                        <Star className="h-3 w-3 mr-1" />
                        VIP
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center p-2 bg-muted rounded">
                      <div className="font-bold">{customer.total_visits}</div>
                      <div className="text-xs text-muted-foreground">Visits</div>
                    </div>
                    <div className="text-center p-2 bg-muted rounded">
                      <div className={`font-bold ${getReliabilityColor(customer.reliability_score || 100)}`}>
                        {customer.reliability_score || 100}%
                      </div>
                      <div className="text-xs text-muted-foreground">Reliability</div>
                    </div>
                    <div className="text-center p-2 bg-muted rounded">
                      <div className="font-bold text-red-600">{customer.no_show_count}</div>
                      <div className="text-xs text-muted-foreground">No-shows</div>
                    </div>
                  </div>

                  {/* Tags */}
                  {customer.tags && customer.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {customer.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {customer.tags.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{customer.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Warnings */}
                  {(customer.no_show_count > 2 || (customer.reliability_score || 100) < 50) && (
                    <div className="flex items-center gap-2 mt-3 p-2 bg-red-50 rounded text-red-600 text-sm">
                      <AlertCircle className="h-4 w-4" />
                      <span>High no-show risk</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Empty state before search */}
      {searchQuery.length < 2 && (
        <div className="text-center py-12">
          <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Type at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
}
