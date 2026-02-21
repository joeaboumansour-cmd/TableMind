"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Users,
  Calendar,
  Clock,
  Utensils,
  Phone,
  Star,
  AlertCircle,
  ChefHat,
  Receipt,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

const supabase = createClient();

interface Customer {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  total_visits: number;
  notes?: string;
  food_preferences?: string[];
  dietary_restrictions?: string[];
  last_visit_date?: string;
  reliability_score?: number;
}

interface Table {
  id: string;
  name: string;
  capacity: number;
  status: "available" | "occupied" | "reserved" | "cleaning";
  current_reservation?: {
    customer_name: string;
    party_size: number;
    notes?: string;
  };
}

export default function MobileDashboard() {
  const [searchPhone, setSearchPhone] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data } = await supabase.from("restaurants").select("id").limit(1).single();
      return data?.id || null;
    },
  });

  // Fetch tables with current status
  const { data: tables = [] } = useQuery({
    queryKey: ["mobile-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      // Get tables
      const { data: tablesData } = await supabase
        .from("tables")
        .select("id, name, capacity")
        .eq("restaurant_id", restaurantId)
        .order("name");

      // Get current reservations
      const now = new Date().toISOString();
      const { data: reservations } = await supabase
        .from("reservations")
        .select("table_id, customer_name, party_size, notes, status")
        .eq("restaurant_id", restaurantId)
        .lte("start_time", now)
        .gte("end_time", now)
        .in("status", ["booked", "confirmed", "seated"]);

      return (tablesData || []).map((table: { id: string; name: string; capacity: number }) => {
        const reservation = reservations?.find((r: { table_id: string }) => r.table_id === table.id);
        return {
          ...table,
          status: reservation ? (reservation.status === "seated" ? "occupied" : "reserved") : "available",
          current_reservation: reservation
            ? {
                customer_name: reservation.customer_name,
                party_size: reservation.party_size,
                notes: reservation.notes,
              }
            : undefined,
        };
      }) as Table[];
    },
    enabled: !!restaurantId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Search customer by phone
  const searchCustomer = async () => {
    if (!searchPhone.trim() || !restaurantId) return;
    
    setIsSearching(true);
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .ilike("phone", `%${searchPhone}%`)
      .limit(5);
    
    setSearchResults(data || []);
    setIsSearching(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available": return "bg-green-500";
      case "occupied": return "bg-red-500";
      case "reserved": return "bg-yellow-500";
      case "cleaning": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "available": return "Free";
      case "occupied": return "Occupied";
      case "reserved": return "Reserved";
      case "cleaning": return "Cleaning";
      default: return status;
    }
  };

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">TableMind</h1>
          <p className="text-sm text-muted-foreground">Staff Mobile</p>
        </div>
        <div className="flex gap-2">
          <Link href="/mobile/lookup">
            <Button variant="outline" size="icon">
              <Search className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-600">
              {tables.filter((t) => t.status === "available").length}
            </div>
            <div className="text-xs text-muted-foreground">Free</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-600">
              {tables.filter((t) => t.status === "occupied").length}
            </div>
            <div className="text-xs text-muted-foreground">Occupied</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {tables.filter((t) => t.status === "reserved").length}
            </div>
            <div className="text-xs text-muted-foreground">Reserved</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold">
              {tables.reduce((acc, t) => acc + (t.current_reservation?.party_size || 0), 0)}
            </div>
            <div className="text-xs text-muted-foreground">Covers</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Customer Lookup */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Search className="h-4 w-4" />
            Quick Customer Lookup
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="Enter phone number..."
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCustomer()}
              className="flex-1"
            />
            <Button onClick={searchCustomer} disabled={isSearching}>
              {isSearching ? "..." : "Find"}
            </Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((customer) => (
                <Link key={customer.id} href={`/mobile/customer/${customer.id}`}>
                  <Card className="cursor-pointer hover:bg-accent">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{customer.name}</p>
                          <p className="text-sm text-muted-foreground">{customer.phone}</p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                      {customer.tags && customer.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {customer.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tables Grid */}
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Utensils className="h-4 w-4" />
        Tables
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {tables.map((table) => (
          <Link key={table.id} href={`/mobile/table/${table.id}`}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-bold text-lg">{table.name}</h4>
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(table.status)}`} />
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  Seats {table.capacity} • {getStatusText(table.status)}
                </p>
                {table.current_reservation && (
                  <div className="text-sm">
                    <p className="font-medium truncate">{table.current_reservation.customer_name}</p>
                    <p className="text-muted-foreground">{table.current_reservation.party_size} guests</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-2 flex justify-around">
        <Link href="/mobile">
          <Button variant="ghost" className="flex-col h-auto py-2">
            <Utensils className="h-5 w-5 mb-1" />
            <span className="text-xs">Tables</span>
          </Button>
        </Link>
        <Link href="/mobile/lookup">
          <Button variant="ghost" className="flex-col h-auto py-2">
            <Search className="h-5 w-5 mb-1" />
            <span className="text-xs">Lookup</span>
          </Button>
        </Link>
        <Link href="/mobile/waitlist">
          <Button variant="ghost" className="flex-col h-auto py-2">
            <Clock className="h-5 w-5 mb-1" />
            <span className="text-xs">Waitlist</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
