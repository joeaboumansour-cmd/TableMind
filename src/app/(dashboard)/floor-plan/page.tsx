"use client";

import { useState } from "react";
import { FloorPlan } from "@/components/floor-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, LayoutGrid, Plus, Users, Clock, Phone } from "lucide-react";
import type { Table, Reservation } from "@/lib/types";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useRestaurant } from "@/app/RestaurantContext";
import { formatDate, formatTime12h } from "@/lib/utils/date";

export default function FloorPlanPage() {
  const { restaurant } = useRestaurant();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  // Fetch reservations for the selected table
  const { data: tableReservations = [] } = useQuery({
    queryKey: ["table-reservations", selectedTable?.id, selectedDate],
    queryFn: async () => {
      if (!selectedTable?.id || !restaurant?.id) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("table_id", selectedTable.id)
        .gte("start_time", `${selectedDate}T00:00:00`)
        .lte("start_time", `${selectedDate}T23:59:59`)
        .order("start_time");
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedTable?.id && !!restaurant?.id,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "seated":
        return <Badge className="bg-red-500">Occupied</Badge>;
      case "confirmed":
      case "booked":
        return <Badge className="bg-amber-400 text-black">Reserved</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-4xl font-bold mb-1">Floor Plan</h1>
          <p className="text-sm lg:text-xl text-muted-foreground">
            Visual table layout and real-time occupancy
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="date" className="sr-only">
              Date
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="pl-10 w-[180px]"
              />
            </div>
          </div>
          <Link href="/reservations">
            <Button variant="outline" className="gap-2">
              <LayoutGrid className="h-4 w-4" />
              List View
            </Button>
          </Link>
          <Link href="/settings/tables">
            <Button variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Table
            </Button>
          </Link>
        </div>
      </div>

      {/* Floor Plan */}
      <FloorPlan
        selectedDate={selectedDate}
        onTableClick={setSelectedTable}
      />

      {/* Table Details Dialog */}
      <Dialog
        open={!!selectedTable}
        onOpenChange={() => setSelectedTable(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {selectedTable?.name}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Table Info */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Capacity</Label>
                <p className="font-semibold flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {selectedTable?.capacity} seats
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Shape</Label>
                <p className="font-semibold capitalize">
                  {selectedTable?.shape}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Reservations</Label>
                <p className="font-semibold">{tableReservations.length}</p>
              </div>
            </div>

            {selectedTable?.room_name && (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Location</Label>
                <p className="font-semibold">
                  {selectedTable.room_name}
                  {selectedTable.section && ` - ${selectedTable.section}`}
                </p>
              </div>
            )}

            <div className="border-t border-border" />

            {/* Reservations for this table */}
            <div>
              <h3 className="font-semibold mb-2">
                Reservations for {formatDate(selectedDate)}
              </h3>
              
              {tableReservations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground bg-muted/50 rounded-lg">
                  <p>No reservations for this table on this date</p>
                </div>
              ) : (
                <div className="h-[200px] overflow-y-auto pr-2 space-y-2">
                    {tableReservations.map((reservation: Reservation) => (
                      <div
                        key={reservation.id}
                        className="p-3 bg-muted/50 rounded-lg space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">
                              {formatTime12h(reservation.start_time)}
                            </span>
                            <span className="text-muted-foreground">
                              ({reservation.party_size} guests)
                            </span>
                          </div>
                          {getStatusBadge(reservation.status)}
                        </div>
                        <div>
                          <p className="font-medium">{reservation.customer_name}</p>
                          {reservation.customer_phone && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {reservation.customer_phone}
                            </p>
                          )}
                          {reservation.notes && (
                            <p className="text-sm text-muted-foreground italic mt-1">
                              &ldquo;{reservation.notes}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
              </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Link
                href={`/reservations?table=${selectedTable?.id}`}
                className="flex-1"
              >
                <Button variant="outline" className="w-full">
                  View All Reservations
                </Button>
              </Link>
              <Link
                href={`/reservations?table=${selectedTable?.id}&new=true`}
                className="flex-1"
              >
                <Button className="w-full">
                  New Reservation
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
