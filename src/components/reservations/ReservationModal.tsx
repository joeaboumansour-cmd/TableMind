"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Edit, Star, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

export interface Table {
  id: string;
  name: string;
  capacity: number;
}

export interface Reservation {
  id?: string;
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  table_id: string;
  start_time: string;
  end_time: string;
  status: "booked" | "confirmed" | "seated" | "finished" | "cancelled" | "no_show";
  notes?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  total_visits: number;
  last_visit?: string;
}

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  reservation?: Reservation | null;
  restaurantId: string | null;
  tables: Table[];
  selectedDate?: string;
  selectedSlot?: { tableId: string; slotIndex: number } | null;
  onSuccess?: () => void;
}

// Generate time slots from 8:00 AM to 12:00 AM (15-minute increments)
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 8; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const time = `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
      const value = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
      slots.push({ time, value, hour, minute });
    }
  }
  return slots;
};

const timeSlots = generateTimeSlots();

// Format time from 24h to 12h
const formatTime12h = (timeString: string) => {
  const match = timeString.match(/T(\d{2}):(\d{2})/);
  if (!match) return "--:--";
  const hours = parseInt(match[1], 10);
  const mins = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${mins} ${period}`;
};

export default function ReservationModal({
  isOpen,
  onClose,
  mode,
  reservation,
  restaurantId,
  tables,
  selectedDate,
  selectedSlot,
  onSuccess,
}: ReservationModalProps) {
  const queryClient = useQueryClient();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Form state
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    party_size: 2,
    table_id: "",
    date: today,
    time: "19:00",
    duration: 90,
    status: "booked" as Reservation["status"],
    notes: "",
  });
  const [foundCustomerName, setFoundCustomerName] = useState<string | null>(null);
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const prevIsOpenRef = useRef(isOpen);

  // Fetch customers for phone lookup - same as reservations page
  const { data: customers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone, tags, total_visits, last_visit_date")
        .eq("restaurant_id", restaurantId);
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId, // Fetch when restaurantId is available (same as reservations page)
  });

  // Initialize form data when modal opens
  useEffect(() => {
    // Only initialize when modal transitions from closed to open
    if (isOpen && !prevIsOpenRef.current) {
      if (mode === "edit" && reservation) {
        const date = reservation.start_time.split("T")[0];
        const timeMatch = reservation.start_time.match(/T(\d{2}):(\d{2})/);
        const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : "19:00";

        // Calculate duration
        const start = new Date(reservation.start_time).getTime();
        const end = new Date(reservation.end_time).getTime();
        const durationMinutes = Math.round((end - start) / (1000 * 60));

        setFormData({
          customer_name: reservation.customer_name,
          customer_phone: reservation.customer_phone || "",
          party_size: reservation.party_size,
          table_id: reservation.table_id,
          date,
          time,
          duration: durationMinutes,
          status: reservation.status,
          notes: reservation.notes || "",
        });

        // Find customer for display
        const matchedCustomer = customers.find(
          (c: Customer) => c.phone === reservation.customer_phone
        );
        if (matchedCustomer) {
          setFoundCustomer(matchedCustomer);
          setFoundCustomerName(matchedCustomer.name);
        }
      } else if (mode === "create") {
        // For create mode, set initial values
        setFormData({
          customer_name: "",
          customer_phone: "",
          party_size: 2,
          table_id: selectedSlot?.tableId || "",
          date: selectedDate || today,
          time: selectedSlot
            ? `${(8 + Math.floor(selectedSlot.slotIndex / 4)).toString().padStart(2, "0")}:${((selectedSlot.slotIndex % 4) * 15).toString().padStart(2, "0")}`
            : "19:00",
          duration: 90,
          status: "booked",
          notes: "",
        });
        setFoundCustomer(null);
        setFoundCustomerName(null);
      }
      setFormErrors({});
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, mode, reservation, selectedDate, selectedSlot, today, customers]);

  // Lookup customer by phone number
  useEffect(() => {
    console.log("=== Phone Lookup Debug ===");
    console.log("Phone entered:", formData.customer_phone);
    console.log("Phone length:", formData.customer_phone?.length);
    console.log("Customers loaded:", customers.length);
    console.log("Restaurant ID:", restaurantId);
    console.log("Is loading customers:", isLoadingCustomers);
    
    if (isLoadingCustomers) {
      console.log("Still loading customers...");
      return;
    }
    
    if (!formData.customer_phone || formData.customer_phone.length < 3) {
      console.log("Phone too short (< 3 chars), clearing results");
      setFoundCustomerName(null);
      setFoundCustomer(null);
      return;
    }

    if (customers.length === 0) {
      console.log("No customers in database for this restaurant");
      setFoundCustomerName(null);
      setFoundCustomer(null);
      return;
    }

    // Find customer by phone (exact match or contains)
    const phoneDigits = formData.customer_phone.replace(/\D/g, "");
    console.log("Searching for phone digits:", phoneDigits);
    console.log("Available customers:", customers.map((c: Customer) => ({ name: c.name, phone: c.phone })));
    
    const matchedCustomer = customers.find((c: Customer) => {
      const customerPhoneDigits = c.phone.replace(/\D/g, "");
      console.log(`Comparing: input "${phoneDigits}" vs customer "${c.name}" "${customerPhoneDigits}"`);
      const match = (
        customerPhoneDigits === phoneDigits ||
        c.phone.includes(formData.customer_phone) ||
        phoneDigits.includes(customerPhoneDigits)
      );
      return match;
    });

    if (matchedCustomer) {
      console.log("✓ MATCH FOUND:", matchedCustomer.name, matchedCustomer.phone);
      setFoundCustomerName(matchedCustomer.name);
      setFoundCustomer(matchedCustomer);
      if (!formData.customer_name || formData.customer_name === foundCustomerName) {
        setFormData((prev) => ({ ...prev, customer_name: matchedCustomer.name }));
      }
    } else {
      console.log("✗ No match found in", customers.length, "customers");
      setFoundCustomerName(null);
      setFoundCustomer(null);
    }
  }, [formData.customer_phone, customers, isLoadingCustomers]);

  // Get suitable tables for party size
  const getSuitableTables = (partySize: number) => {
    return tables
      .filter((t) => t.capacity >= partySize)
      .sort((a, b) => a.capacity - b.capacity);
  };

  // Validate form
  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.customer_name.trim()) errors.name = "Name is required";
    if (!formData.table_id) errors.table_id = "Table is required";
    if (formData.party_size < 1) errors.party_size = "Party size must be at least 1";

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!restaurantId) throw new Error("No restaurant");

      const startDateTime = `${data.date}T${data.time}:00`;
      const [hours, minutes] = data.time.split(":").map(Number);
      const endTotalMinutes = hours * 60 + minutes + data.duration;
      const endHours = Math.floor(endTotalMinutes / 60);
      const endMins = endTotalMinutes % 60;
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMins
        .toString()
        .padStart(2, "0")}`;
      const endDateTime = `${data.date}T${endTime}:00`;

      const { data: result, error } = await supabase
        .from("reservations")
        .insert({
          restaurant_id: restaurantId,
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          party_size: data.party_size,
          table_id: data.table_id,
          start_time: startDateTime,
          end_time: endDateTime,
          status: data.status,
          notes: data.notes,
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation created successfully");
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error("Failed to create reservation: " + error.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<typeof formData>;
    }) => {
      const updateData: Record<string, unknown> = {};

      if (data.customer_name) updateData.customer_name = data.customer_name;
      if (data.customer_phone !== undefined)
        updateData.customer_phone = data.customer_phone;
      if (data.party_size) updateData.party_size = data.party_size;
      if (data.table_id) updateData.table_id = data.table_id;
      if (data.status) updateData.status = data.status;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const { data: result, error } = await supabase
        .from("reservations")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Reservation updated successfully");
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error("Failed to update reservation: " + error.message);
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: Reservation["status"];
    }) => {
      const { data: result, error } = await supabase
        .from("reservations")
        .update({ status })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Status updated");
    },
    onError: (error: Error) => {
      toast.error("Failed to update status: " + error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reservations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation cancelled");
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error("Failed to cancel reservation: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (mode === "edit" && reservation?.id) {
      updateMutation.mutate({ id: reservation.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleStatusChange = (status: Reservation["status"]) => {
    if (reservation?.id) {
      statusMutation.mutate({ id: reservation.id, status });
      setFormData((prev) => ({ ...prev, status }));
    }
  };

  const handleDelete = () => {
    if (reservation?.id && confirm("Are you sure you want to cancel this reservation?")) {
      deleteMutation.mutate(reservation.id);
    }
  };

  const getStatusColor = (status: Reservation["status"]) => {
    switch (status) {
      case "booked":
        return "bg-blue-500 hover:bg-blue-600";
      case "confirmed":
        return "bg-indigo-500 hover:bg-indigo-600";
      case "seated":
        return "bg-green-500 hover:bg-green-600";
      case "finished":
        return "bg-gray-500 hover:bg-gray-600";
      case "cancelled":
        return "bg-red-500 hover:bg-red-600";
      case "no_show":
        return "bg-amber-500 hover:bg-amber-600";
      default:
        return "bg-blue-500 hover:bg-blue-600";
    }
  };

  const suitableTables = getSuitableTables(formData.party_size);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "create" ? (
              <>
                <Plus className="h-5 w-5" />
                New Reservation
              </>
            ) : (
              <>
                <Edit className="h-5 w-5" />
                Edit Reservation
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Status Quick Actions - Only for Edit */}
          {mode === "edit" && (
            <div className="flex gap-2 flex-wrap">
              {[
                { status: "booked", label: "Booked" },
                { status: "confirmed", label: "Confirmed" },
                { status: "seated", label: "Seated" },
                { status: "finished", label: "Finished" },
              ].map(({ status, label }) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  className={`${
                    formData.status === status
                      ? getStatusColor(status as Reservation["status"])
                      : "bg-muted"
                  } text-white`}
                  onClick={() =>
                    handleStatusChange(status as Reservation["status"])
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {/* Phone Number */}
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <div className="relative">
              <Input
                id="phone"
                value={formData.customer_phone}
                onChange={(e) =>
                  setFormData({ ...formData, customer_phone: e.target.value })
                }
                placeholder="555-0101"
                className={foundCustomerName ? "pr-10 border-green-500 focus-visible:ring-green-500" : ""}
              />
              {isLoadingCustomers && formData.customer_phone.length >= 3 && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              )}
              {foundCustomerName && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-300 text-xs"
                  >
                    Found
                  </Badge>
                </div>
              )}
            </div>
            {foundCustomer && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-primary" />
                    <span className="font-medium">{foundCustomer.name}</span>
                    <Badge variant="secondary">
                      {foundCustomer.total_visits} visits
                    </Badge>
                  </div>
                  {foundCustomer.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {foundCustomer.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            {!isLoadingCustomers && formData.customer_phone.length >= 3 && !foundCustomer && (
              <p className="text-xs text-muted-foreground">
                No existing customer found with this phone number
              </p>
            )}
          </div>

          {/* Customer Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Customer Name *{" "}
              {foundCustomerName && (
                <span className="text-xs text-green-600 font-normal">
                  (auto-filled)
                </span>
              )}
            </Label>
            <Input
              id="name"
              value={formData.customer_name}
              onChange={(e) =>
                setFormData({ ...formData, customer_name: e.target.value })
              }
              placeholder="Customer name"
              className={formErrors.name ? "border-red-500" : ""}
              required
            />
            {formErrors.name && (
              <p className="text-xs text-red-500">{formErrors.name}</p>
            )}
          </div>

          {/* Party Size & Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Party Size</Label>
              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                  <Button
                    key={size}
                    type="button"
                    size="sm"
                    variant={formData.party_size === size ? "default" : "outline"}
                    className="flex-1 min-w-[40px] h-10"
                    onClick={() =>
                      setFormData({ ...formData, party_size: size })
                    }
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="flex gap-1 flex-wrap">
                {[60, 90, 120, 150, 180].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    size="sm"
                    variant={formData.duration === mins ? "default" : "outline"}
                    className="h-10 px-3"
                    onClick={() =>
                      setFormData({ ...formData, duration: mins })
                    }
                  >
                    {mins}m
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Date & Time - Only for Create mode, display for Edit */}
          {mode === "create" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  min={today}
                  value={formData.date}
                  onChange={(e) =>
                    setFormData({ ...formData, date: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time *</Label>
                <Select
                  value={formData.time}
                  onValueChange={(value) =>
                    setFormData({ ...formData, time: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select time" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {timeSlots.map((slot) => (
                      <SelectItem key={slot.value} value={slot.value}>
                        {slot.time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            reservation && (
              <div className="grid grid-cols-2 gap-4 bg-muted p-3 rounded-lg">
                <div>
                  <div className="text-xs text-muted-foreground">Start</div>
                  <div className="font-semibold">
                    {formatTime12h(reservation.start_time)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">End</div>
                  <div className="font-semibold">
                    {formatTime12h(reservation.end_time)}
                  </div>
                </div>
              </div>
            )
          )}

          {/* Table Selection */}
          <div className="space-y-2">
            <Label>Table *</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {suitableTables.map((table) => (
                <Button
                  key={table.id}
                  type="button"
                  variant={formData.table_id === table.id ? "default" : "outline"}
                  className="justify-start h-auto py-2"
                  onClick={() =>
                    setFormData({ ...formData, table_id: table.id })
                  }
                >
                  <div className="text-left">
                    <div className="text-sm font-medium">{table.name}</div>
                    <div className="text-xs opacity-70">{table.capacity} seats</div>
                  </div>
                </Button>
              ))}
            </div>
            {suitableTables.length === 0 && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                No tables available for {formData.party_size} guests
              </p>
            )}
            {formErrors.table_id && (
              <p className="text-xs text-red-500">{formErrors.table_id}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              placeholder="Special requests, allergies, occasion..."
              className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-sm resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                suitableTables.length === 0
              }
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : mode === "create"
                ? "Create Reservation"
                : "Save Changes"}
            </Button>
          </div>

          {/* Delete Button - Only for Edit */}
          {mode === "edit" && (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteMutation.isPending ? "Cancelling..." : "Cancel Reservation"}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
