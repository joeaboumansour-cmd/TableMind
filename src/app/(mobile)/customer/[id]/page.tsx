"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WhatsAppButton } from "@/components/whatsapp";
import {
  ChevronLeft,
  User,
  Phone,
  Star,
  Calendar,
  AlertCircle,
  ChefHat,
  MessageCircle,
  Utensils,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
  first_visit_date?: string;
}

export default function MobileCustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;

  // Fetch customer
  const { data: customer, isLoading } = useQuery({
    queryKey: ["mobile-customer", customerId],
    queryFn: async () => {
      if (!customerId) return null;
      
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      
      return data as Customer;
    },
    enabled: !!customerId,
  });

  // Fetch recent reservations
  interface Reservation {
    start_time: string;
    status: string;
    party_size: number;
    notes?: string;
  }
  
  const { data: recentReservations = [] } = useQuery({
    queryKey: ["mobile-customer-reservations", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      
      const { data } = await supabase
        .from("reservations")
        .select("start_time, status, party_size, notes")
        .eq("customer_id", customerId)
        .order("start_time", { ascending: false })
        .limit(5);
      
      return (data || []) as Reservation[];
    },
    enabled: !!customerId,
  });

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-3/4" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-48 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Customer not found</p>
        <Link href="/mobile/lookup">
          <Button className="mt-4">Back to Search</Button>
        </Link>
      </div>
    );
  }

  const reliabilityScore = customer.reliability_score || 100;
  const isVIP = customer.tags?.includes("VIP");
  const isHighRisk = customer.no_show_count > 2 || reliabilityScore < 50;

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mobile/lookup">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Guest Profile</h1>
      </div>

      {/* Profile Card */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">{customer.name}</h2>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  {customer.phone}
                </div>
              </div>
            </div>
            {isVIP && (
              <Badge className="bg-amber-500 text-white">
                <Star className="h-3 w-3 mr-1" />
                VIP
              </Badge>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            <WhatsAppButton
              phoneNumber={customer.phone}
              customerName={customer.name}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-primary">{customer.total_visits}</div>
            <div className="text-sm text-muted-foreground">Total Visits</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className={`text-3xl font-bold ${reliabilityScore >= 90 ? "text-green-600" : reliabilityScore >= 70 ? "text-yellow-600" : "text-red-600"}`}>
              {reliabilityScore}%
            </div>
            <div className="text-sm text-muted-foreground">Reliability</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{customer.no_show_count}</div>
            <div className="text-sm text-muted-foreground">No-shows</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">{customer.cancellation_count}</div>
            <div className="text-sm text-muted-foreground">Cancellations</div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {isHighRisk && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <span className="font-semibold">High No-Show Risk</span>
            </div>
            <p className="text-sm text-red-600 mt-1">
              Consider requiring deposit or confirmation for reservations.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Special Dates */}
      {(customer.birthday || customer.last_visit_date) && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Important Dates</h3>
            {customer.birthday && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🎂</span>
                <div>
                  <p className="font-medium">Birthday</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(customer.birthday).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
            )}
            {customer.last_visit_date && (
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Last Visit</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(customer.last_visit_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preferences */}
      {((customer.food_preferences?.length || 0) > 0 || (customer.dietary_restrictions?.length || 0) > 0) && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ChefHat className="h-4 w-4" />
              Preferences & Restrictions
            </h3>
            {(customer.food_preferences?.length || 0) > 0 && (
              <div className="mb-3">
                <p className="text-sm text-muted-foreground mb-1">Preferences</p>
                <div className="flex gap-1 flex-wrap">
                  {customer.food_preferences?.map((pref) => (
                    <Badge key={pref} variant="secondary">
                      {pref}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {(customer.dietary_restrictions?.length || 0) > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Dietary Restrictions</p>
                <div className="flex gap-1 flex-wrap">
                  {customer.dietary_restrictions?.map((restriction) => (
                    <Badge key={restriction} variant="destructive">
                      {restriction}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {customer.tags?.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Tags</h3>
            <div className="flex gap-2 flex-wrap">
              {customer.tags.map((tag) => (
                <Badge key={tag} variant={tag === "VIP" ? "default" : "secondary"}>
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {customer.notes && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Notes
            </h3>
            <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Recent Reservations */}
      {recentReservations.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Reservations
            </h3>
            <div className="space-y-2">
              {recentReservations.map((reservation, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-muted rounded"
                >
                  <div>
                    <p className="font-medium">
                      {new Date(reservation.start_time).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {reservation.party_size} guests • {reservation.status}
                    </p>
                  </div>
                  <Badge
                    variant={
                      reservation.status === "finished"
                        ? "default"
                        : reservation.status === "cancelled"
                        ? "destructive"
                        : reservation.status === "no_show"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {reservation.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
