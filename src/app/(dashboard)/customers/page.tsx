"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { useRestaurant } from "@/app/RestaurantContext";
import { Search, User, Phone, Calendar, X, Plus, Users, MessageCircle, Filter, CheckSquare, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { WhatsAppButton, WhatsAppModal, BulkWhatsAppModal } from "@/components/whatsapp";
import { toast } from "sonner";
import { isValidPhoneNumber, getPhoneValidationError, getNameValidationError, isValidCustomerName, isValidEmail } from "@/lib/utils/validation";
import {
  calculateRFMSegment,
  getRFMSegmentColor,
  calculateHealthScore,
  getHealthScoreColor,
  calculateLifecycleStage,
  getLifecycleColor,
  generateWinBackRecommendation,
  type RFMSegment,
  type LifecycleStage,
  type WinBackRecommendation,
} from "@/lib/utils/customerAnalytics";
import { Heart, AlertCircle, TrendingUp, Sparkles } from "lucide-react";

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
  risk_level?: string;
  birthday?: string;
  food_preferences?: string[];
  dietary_restrictions?: string[];
}

interface CustomerSegment {
  id: string;
  name: string;
  description: string;
  filters: Record<string, unknown>;
  customer_count: number;
}

export default function CustomersPage() {
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.id;
  const restaurantName = restaurant?.name || "Your Restaurant";
  
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  
  // Add customer dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    tags: [] as string[],
  });
  const [newCustomerTag, setNewCustomerTag] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // WhatsApp modal states
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isBulkWhatsAppModalOpen, setIsBulkWhatsAppModalOpen] = useState(false);

  // Advanced filtering states
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<string>("");
  const [minVisits, setMinVisits] = useState<string>("");
  const [maxVisits, setMaxVisits] = useState<string>("");
  const [reliabilityFilter, setReliabilityFilter] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hasBirthdayThisMonth, setHasBirthdayThisMonth] = useState(false);
  const [monthsSinceVisit, setMonthsSinceVisit] = useState<string>("");
  const [rfmFilter, setRfmFilter] = useState<RFMSegment | "">("");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | "">("");
  const [healthStatusFilter, setHealthStatusFilter] = useState<"Healthy" | "At Risk" | "Critical" | "">("");

  // Bulk selection states
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Fetch customer segments
  const { data: segments = [] } = useQuery({
    queryKey: ["customer-segments", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customer_segments")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name");
      if (error) return [];
      return data as CustomerSegment[];
    },
    enabled: !!restaurantId,
  });

  // Fetch customers from customer_analytics view
  // This view includes calculated fields like reliability_score and risk_level
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customer_analytics")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });
      
      if (error) {
        console.error("Error fetching customers:", error);
        return [];
      }
      return data as Customer[];
    },
    enabled: !!restaurantId,
  });

  // Get all unique tags from customers
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    customers.forEach((c) => c.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [customers]);

  // Apply advanced filters
  const filteredCustomers = useMemo(() => {
    let filtered = [...customers];

    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.phone.includes(query) ||
          c.email?.toLowerCase().includes(query) ||
          c.tags?.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Segment filter
    if (selectedSegment) {
      const segment = segments.find((s) => s.id === selectedSegment);
      if (segment) {
        // Apply segment filters
        const filters = segment.filters as Record<string, any>;
        if (filters.tags?.contains) {
          filtered = filtered.filter((c) =>
            c.tags?.includes(filters.tags.contains)
          );
        }
        if (filters.min_visits) {
          filtered = filtered.filter(
            (c) => c.total_visits >= filters.min_visits
          );
        }
        if (filters.max_visits) {
          filtered = filtered.filter(
            (c) => c.total_visits <= filters.max_visits
          );
        }
      }
    }

    // Min visits filter
    if (minVisits) {
      filtered = filtered.filter((c) => c.total_visits >= parseInt(minVisits));
    }

    // Max visits filter
    if (maxVisits) {
      filtered = filtered.filter((c) => c.total_visits <= parseInt(maxVisits));
    }

    // Reliability filter
    if (reliabilityFilter) {
      const [min, max] = reliabilityFilter.split("-").map(Number);
      filtered = filtered.filter((c) => {
        const score = c.reliability_score || 100;
        return score >= min && (max ? score <= max : true);
      });
    }

    // Tags filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter((c) =>
        selectedTags.every((tag) => c.tags?.includes(tag))
      );
    }

    // Birthday this month filter
    if (hasBirthdayThisMonth) {
      const currentMonth = new Date().getMonth() + 1;
      filtered = filtered.filter((c) => {
        if (!c.birthday) return false;
        const birthMonth = new Date(c.birthday).getMonth() + 1;
        return birthMonth === currentMonth;
      });
    }

    // Months since last visit filter
    if (monthsSinceVisit) {
      const months = parseInt(monthsSinceVisit);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - months);
      
      filtered = filtered.filter((c) => {
        // Include customers who never visited OR whose last visit is before the cutoff
        if (!c.last_visit_date) return true;
        const lastVisit = new Date(c.last_visit_date);
        return lastVisit < cutoffDate;
      });
    }

    // RFM Segment filter
    if (rfmFilter) {
      filtered = filtered.filter((c) => {
        const rfm = calculateRFMSegment(c);
        return rfm.segment === rfmFilter;
      });
    }

    // Lifecycle Stage filter
    if (lifecycleFilter) {
      filtered = filtered.filter((c) => {
        const lifecycle = calculateLifecycleStage(c);
        return lifecycle.stage === lifecycleFilter;
      });
    }

    // Health Status filter
    if (healthStatusFilter) {
      filtered = filtered.filter((c) => {
        const health = calculateHealthScore(c);
        return health.status === healthStatusFilter;
      });
    }

    return filtered;
  }, [
    customers,
    searchQuery,
    selectedSegment,
    minVisits,
    maxVisits,
    reliabilityFilter,
    selectedTags,
    hasBirthdayThisMonth,
    monthsSinceVisit,
    rfmFilter,
    lifecycleFilter,
    healthStatusFilter,
    segments,
  ]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (customer: Customer) => {
      if (!restaurantId) throw new Error("No restaurant");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customers")
        .update({ notes: customer.notes, tags: customer.tags })
        .eq("id", customer.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer updated successfully");
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (customer: Omit<Customer, "id" | "total_visits" | "no_show_count">) => {
      if (!restaurantId) throw new Error("No restaurant");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customers")
        .insert({ ...customer, restaurant_id: restaurantId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsAddDialogOpen(false);
      setNewCustomer({ name: "", phone: "", email: "", notes: "", tags: [] });
      toast.success("Customer created successfully");
    },
  });

  // Open customer profile
  const openProfile = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditedNotes(customer.notes || "");
    setEditedTags([...customer.tags]);
    setIsSheetOpen(true);
  };

  // Save changes
  const handleSave = () => {
    if (selectedCustomer) {
      updateMutation.mutate({
        ...selectedCustomer,
        notes: editedNotes,
        tags: editedTags,
      });
    }
  };

  // Add tag
  const handleAddTag = () => {
    if (newTag.trim() && !editedTags.includes(newTag.trim())) {
      setEditedTags([...editedTags, newTag.trim()]);
      setNewTag("");
    }
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove: string) => {
    setEditedTags(editedTags.filter((t) => t !== tagToRemove));
  };

  // Toggle customer selection
  const toggleCustomerSelection = (customerId: string) => {
    const newSelected = new Set(selectedCustomers);
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId);
    } else {
      newSelected.add(customerId);
    }
    setSelectedCustomers(newSelected);
  };

  // Select all visible customers
  const selectAllVisible = () => {
    if (selectedCustomers.size === filteredCustomers.length) {
      setSelectedCustomers(new Set());
    } else {
      setSelectedCustomers(new Set(filteredCustomers.map((c) => c.id)));
    }
  };

  // Get selected customer objects
  const selectedCustomerObjects = useMemo(() => {
    return customers.filter((c) => selectedCustomers.has(c.id));
  }, [customers, selectedCustomers]);

  // Calculate stats
  const totalCustomers = customers.length;
  const vipCustomers = customers.filter((c: Customer) => c.tags?.includes("VIP")).length;
  const filteredCount = filteredCustomers.length;

  // Add customer tag handlers
  const handleAddNewCustomerTag = () => {
    if (newCustomerTag.trim() && !newCustomer.tags.includes(newCustomerTag.trim())) {
      setNewCustomer({ ...newCustomer, tags: [...newCustomer.tags, newCustomerTag.trim()] });
      setNewCustomerTag("");
    }
  };

  const handleRemoveNewCustomerTag = (tagToRemove: string) => {
    setNewCustomer({ ...newCustomer, tags: newCustomer.tags.filter((t) => t !== tagToRemove) });
  };

  const handleCreateCustomer = () => {
    // Validate name
    const nameErr = getNameValidationError(newCustomer.name);
    setNameError(nameErr);
    
    // Validate phone
    const phoneErr = getPhoneValidationError(newCustomer.phone);
    setPhoneError(phoneErr);
    
    // Validate email if provided
    if (newCustomer.email && !isValidEmail(newCustomer.email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    
    // Stop if validation errors
    if (nameErr || phoneErr) {
      toast.error("Please fix the validation errors");
      return;
    }
    
    createMutation.mutate({
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim(),
      email: newCustomer.email || undefined,
      notes: newCustomer.notes,
      tags: newCustomer.tags,
      cancellation_count: 0,
    });
  };
  
  // Reset validation errors when dialog closes
  const handleDialogOpenChange = (open: boolean) => {
    setIsAddDialogOpen(open);
    if (!open) {
      setPhoneError(null);
      setNameError(null);
      setNewCustomer({ name: "", phone: "", email: "", notes: "", tags: [] });
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSelectedSegment("");
    setMinVisits("");
    setMaxVisits("");
    setReliabilityFilter("");
    setSelectedTags([]);
    setHasBirthdayThisMonth(false);
    setMonthsSinceVisit("");
    setRfmFilter("");
    setLifecycleFilter("");
    setHealthStatusFilter("");
    setSearchQuery("");
  };

  // Check if any filters are active
  const hasActiveFilters =
    selectedSegment ||
    minVisits ||
    maxVisits ||
    reliabilityFilter ||
    selectedTags.length > 0 ||
    hasBirthdayThisMonth ||
    monthsSinceVisit ||
    rfmFilter ||
    lifecycleFilter ||
    healthStatusFilter;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2">Customers</h1>
          <p className="text-xl text-muted-foreground">
            Manage guest profiles and preferences
          </p>
        </div>
        <div className="flex gap-3">
          {isSelectionMode && selectedCustomers.size > 0 && (
            <Button
              variant="default"
              className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
              onClick={() => setIsBulkWhatsAppModalOpen(true)}
            >
              <MessageCircle className="h-5 w-5" />
              WhatsApp ({selectedCustomers.size})
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setIsSelectionMode(!isSelectionMode)}
          >
            {isSelectionMode ? (
              <><X className="h-5 w-5" /> Cancel</>
            ) : (
              <><CheckSquare className="h-5 w-5" /> Select</>
            )}
          </Button>
          <Button 
            size="lg" 
            className="gap-2 text-lg px-6 py-6"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-5 w-5" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2">{totalCustomers}</div>
            <div className="text-xl text-muted-foreground">Total Customers</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2 text-primary">{vipCustomers}</div>
            <div className="text-xl text-muted-foreground">VIP Guests</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2">
              {Math.round(
                customers.reduce((acc: number, c: Customer) => acc + c.total_visits, 0) /
                  (customers.length || 1)
              )}
            </div>
            <div className="text-xl text-muted-foreground">Avg Visits</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2 text-[#25D366]">
              {filteredCount}
            </div>
            <div className="text-xl text-muted-foreground">Filtered</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <div className="mb-8 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, email, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-14 py-6 text-xl bg-background border-2"
            />
          </div>
          <Button
            variant="outline"
            className={`gap-2 px-6 ${hasActiveFilters ? "bg-primary/10 border-primary" : ""}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-5 w-5" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1">
                Active
              </Badge>
            )}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Advanced Filters</h3>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear All
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Segment Filter */}
              <div className="space-y-2">
                <Label>Segment</Label>
                <Select value={selectedSegment || "all"} onValueChange={(value) => setSelectedSegment(value === "all" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All segments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All segments</SelectItem>
                    {segments.map((segment) => (
                      <SelectItem key={segment.id} value={segment.id}>
                        {segment.name} ({segment.customer_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Min Visits */}
              <div className="space-y-2">
                <Label>Min Visits</Label>
                <Select value={minVisits || "0"} onValueChange={setMinVisits}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any</SelectItem>
                    <SelectItem value="1">1+ visits</SelectItem>
                    <SelectItem value="5">5+ visits</SelectItem>
                    <SelectItem value="10">10+ visits</SelectItem>
                    <SelectItem value="20">20+ visits</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Reliability */}
              <div className="space-y-2">
                <Label>Reliability</Label>
                <Select value={reliabilityFilter || "any"} onValueChange={(value) => setReliabilityFilter(value === "any" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="90">90%+ (Excellent)</SelectItem>
                    <SelectItem value="70-89">70-89% (Good)</SelectItem>
                    <SelectItem value="50-69">50-69% (Fair)</SelectItem>
                    <SelectItem value="0-49">Below 50% (Poor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Tags Filter */}
              <div className="space-y-2">
                <Label>Tags</Label>
                <Select
                  value={selectedTags[0] || "any"}
                  onValueChange={(value) =>
                    setSelectedTags(value === "any" ? [] : [value])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any tag</SelectItem>
                    {allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Months Since Last Visit Filter */}
              <div className="space-y-2">
                <Label>Not visited in</Label>
                <Select value={monthsSinceVisit || "any"} onValueChange={(value) => setMonthsSinceVisit(value === "any" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any time</SelectItem>
                    <SelectItem value="1">1 month+</SelectItem>
                    <SelectItem value="2">2 months+</SelectItem>
                    <SelectItem value="3">3 months+</SelectItem>
                    <SelectItem value="6">6 months+</SelectItem>
                    <SelectItem value="12">12 months+</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Birthday Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={hasBirthdayThisMonth}
                    onCheckedChange={(checked) =>
                      setHasBirthdayThisMonth(checked as boolean)
                    }
                  />
                  Birthday this month
                </Label>
              </div>
            </div>

            {/* Second Row - Analytics Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {/* RFM Segment Filter */}
              <div className="space-y-2">
                <Label>RFM Segment</Label>
                <Select value={rfmFilter || "all"} onValueChange={(value) => setRfmFilter(value === "all" ? "" : value as RFMSegment)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All segments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All RFM segments</SelectItem>
                    <SelectItem value="Champions">🏆 Champions</SelectItem>
                    <SelectItem value="Loyal Customers">💙 Loyal Customers</SelectItem>
                    <SelectItem value="Potential Loyalists">🌱 Potential Loyalists</SelectItem>
                    <SelectItem value="At Risk">⚠️ At Risk</SelectItem>
                    <SelectItem value="Cannot Lose Them">🚨 Cannot Lose Them</SelectItem>
                    <SelectItem value="Lost">😞 Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Lifecycle Stage Filter */}
              <div className="space-y-2">
                <Label>Lifecycle Stage</Label>
                <Select value={lifecycleFilter || "all"} onValueChange={(value) => setLifecycleFilter(value === "all" ? "" : value as LifecycleStage)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All stages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All lifecycle stages</SelectItem>
                    <SelectItem value="New">✨ New</SelectItem>
                    <SelectItem value="Onboarding">📈 Onboarding</SelectItem>
                    <SelectItem value="Establishing">🔄 Establishing</SelectItem>
                    <SelectItem value="Regular">⭐ Regular</SelectItem>
                    <SelectItem value="VIP">👑 VIP</SelectItem>
                    <SelectItem value="Dormant">😴 Dormant</SelectItem>
                    <SelectItem value="Reactivated">🎉 Reactivated</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Health Status Filter */}
              <div className="space-y-2">
                <Label>Health Status</Label>
                <Select value={healthStatusFilter || "all"} onValueChange={(value) => setHealthStatusFilter(value === "all" ? "" : value as "Healthy" | "At Risk" | "Critical")}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All health statuses</SelectItem>
                    <SelectItem value="Healthy">🟢 Healthy</SelectItem>
                    <SelectItem value="At Risk">🟡 At Risk</SelectItem>
                    <SelectItem value="Critical">🔴 Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {isSelectionMode && (
        <div className="mb-4 p-4 bg-muted rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={selectAllVisible}>
              {selectedCustomers.size === filteredCustomers.length ? (
                <><Square className="h-4 w-4 mr-2" /> Deselect All</>
              ) : (
                <><CheckSquare className="h-4 w-4 mr-2" /> Select All ({filteredCount})</>
              )}
            </Button>
            <span className="text-muted-foreground">
              {selectedCustomers.size} selected
            </span>
          </div>
          {selectedCustomers.size > 0 && (
            <Button
              variant="default"
              className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
              onClick={() => setIsBulkWhatsAppModalOpen(true)}
            >
              <MessageCircle className="h-4 w-4" />
              Send WhatsApp ({selectedCustomers.size})
            </Button>
          )}
        </div>
      )}

      {/* Customer List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse h-24" />
          ))}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <Card className="p-12 text-center border-2">
          <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-2xl font-semibold mb-2">No customers found</h3>
          <p className="text-lg text-muted-foreground">
            Try adjusting your search or filters
          </p>
          {hasActiveFilters && (
            <Button variant="outline" className="mt-4" onClick={clearFilters}>
              Clear Filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredCustomers.map((customer: Customer) => (
            <Card
              key={customer.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors border-2"
              onClick={() =>
                isSelectionMode
                  ? toggleCustomerSelection(customer.id)
                  : openProfile(customer)
              }
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    {isSelectionMode && (
                      <div className="flex items-center justify-center">
                        {selectedCustomers.has(customer.id) ? (
                          <CheckSquare className="h-6 w-6 text-primary" />
                        ) : (
                          <Square className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                    )}
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold">{customer.name}</h3>
                      <div className="flex items-center gap-4 mt-2 text-lg text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <Phone className="h-5 w-5" />
                          {customer.phone}
                        </span>
                        <span className="flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          {customer.total_visits} visits
                        </span>
                        {customer.last_visit_date && (
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">Last:</span>
                            {(() => {
                              const lastVisit = new Date(customer.last_visit_date!);
                              const now = new Date();
                              const diffTime = Math.abs(now.getTime() - lastVisit.getTime());
                              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                              const diffMonths = Math.floor(diffDays / 30);
                              
                              if (diffMonths >= 12) {
                                return <span className="text-red-500 font-medium">{Math.floor(diffMonths / 12)}y ago</span>;
                              } else if (diffMonths >= 6) {
                                return <span className="text-orange-500 font-medium">{diffMonths}mo ago</span>;
                              } else if (diffMonths >= 3) {
                                return <span className="text-yellow-600 font-medium">{diffMonths}mo ago</span>;
                              } else if (diffMonths >= 1) {
                                return <span className="text-green-600">{diffMonths}mo ago</span>;
                              } else if (diffDays >= 7) {
                                return <span className="text-green-600">{Math.floor(diffDays / 7)}w ago</span>;
                              } else {
                                return <span className="text-green-600">{diffDays}d ago</span>;
                              }
                            })()}
                          </span>
                        )}
                        {customer.reliability_score !== undefined && (
                          <Badge
                            variant={
                              customer.reliability_score >= 90
                                ? "default"
                                : customer.reliability_score >= 70
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {customer.reliability_score}% reliable
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <div className="flex gap-2 flex-wrap justify-end max-w-xs items-center">
                      {!isSelectionMode && (
                        <WhatsAppButton
                          phoneNumber={customer.phone}
                          customerName={customer.name}
                          onClick={(e) => {
                            e?.stopPropagation();
                            setSelectedCustomer(customer);
                            setIsWhatsAppModalOpen(true);
                          }}
                          size="sm"
                          showLabel={false}
                        />
                      )}
                      {(() => {
                        const rfm = calculateRFMSegment(customer);
                        const health = calculateHealthScore(customer);
                        const lifecycle = calculateLifecycleStage(customer);
                        const winBack = generateWinBackRecommendation(customer);
                        
                        return (
                          <>
                            {/* RFM Segment Badge */}
                            <Badge
                              className={`text-sm px-3 py-1 ${getRFMSegmentColor(rfm.segment)}`}
                            >
                              {rfm.segment}
                            </Badge>
                            
                            {/* Health Score Badge */}
                            <Badge
                              className={`text-sm px-3 py-1 ${getHealthScoreColor(health.score)}`}
                            >
                              <Heart className="h-3 w-3 mr-1 inline" />
                              {health.score}
                            </Badge>
                            
                            {/* Lifecycle Badge */}
                            <Badge
                              className={`text-sm px-3 py-1 ${getLifecycleColor(lifecycle.stage)}`}
                            >
                              {lifecycle.stage}
                            </Badge>
                            
                            {/* Win-Back Alert */}
                            {winBack && (
                              <Badge
                                variant="destructive"
                                className="text-sm px-3 py-1 animate-pulse"
                              >
                                <AlertCircle className="h-3 w-3 mr-1 inline" />
                                {winBack.discountLevel}% off
                              </Badge>
                            )}
                          </>
                        );
                      })()}
                      {customer.tags?.slice(0, 2).map((tag) => (
                        <Badge
                          key={tag}
                          variant={tag === "VIP" ? "default" : "secondary"}
                          className="text-base px-4 py-2"
                        >
                          {tag}
                        </Badge>
                      ))}
                      {customer.tags && customer.tags.length > 2 && (
                        <Badge variant="outline" className="text-base px-4 py-2">
                          +{customer.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Profile Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:max-w-xl bg-background border-l-4">
          {selectedCustomer && (
            <>
              <SheetHeader className="pb-6 border-b">
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-3xl font-bold">
                    {selectedCustomer.name}
                  </SheetTitle>
                  <WhatsAppButton
                    phoneNumber={selectedCustomer.phone}
                    customerName={selectedCustomer.name}
                    onClick={() => setIsWhatsAppModalOpen(true)}
                  />
                </div>
              </SheetHeader>

              <div className="mt-8 space-y-8">
                {/* Customer Analytics Overview */}
                {(() => {
                  const rfm = calculateRFMSegment(selectedCustomer);
                  const health = calculateHealthScore(selectedCustomer);
                  const lifecycle = calculateLifecycleStage(selectedCustomer);
                  const winBack = generateWinBackRecommendation(selectedCustomer);
                  
                  return (
                    <div className="space-y-4">
                      {/* RFM & Lifecycle Badges */}
                      <div className="flex flex-wrap gap-2">
                        <Badge className={`text-base px-4 py-2 ${getRFMSegmentColor(rfm.segment)}`}>
                          <TrendingUp className="h-4 w-4 mr-1 inline" />
                          {rfm.segment}
                        </Badge>
                        <Badge className={`text-base px-4 py-2 ${getLifecycleColor(lifecycle.stage)}`}>
                          <Sparkles className="h-4 w-4 mr-1 inline" />
                          {lifecycle.stage}
                        </Badge>
                        <Badge className={`text-base px-4 py-2 ${getHealthScoreColor(health.score)}`}>
                          <Heart className="h-4 w-4 mr-1 inline" />
                          Health: {health.score}/100
                        </Badge>
                      </div>
                      
                      {/* Win-Back Recommendation */}
                      {winBack && (
                        <div className="bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="h-5 w-5 text-orange-600" />
                            <span className="font-semibold text-orange-800">Win-Back Opportunity</span>
                            <Badge variant="destructive" className="ml-auto">
                              {winBack.urgency} Priority
                            </Badge>
                          </div>
                          <p className="text-sm text-orange-700 mb-3">
                            Suggested: <strong>{winBack.discountLevel}% discount</strong>
                          </p>
                          <p className="text-sm text-muted-foreground italic mb-3">
                            "{winBack.message}"
                          </p>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="w-full border-orange-300 hover:bg-orange-100"
                            onClick={() => {
                              if (!editedTags.includes(winBack.tag)) {
                                setEditedTags([...editedTags, winBack.tag]);
                                toast.success(`Tag "${winBack.tag}" added!`);
                              }
                            }}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add "{winBack.tag}" Tag
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Vital Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-primary/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-primary">
                      {selectedCustomer.total_visits}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Visits
                    </div>
                  </div>
                  <div className="bg-destructive/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-destructive">
                      {selectedCustomer.no_show_count}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      No-Shows
                    </div>
                  </div>
                  <div className="bg-amber-500/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-amber-600">
                      {selectedCustomer.cancellation_count}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Cancelled
                    </div>
                  </div>
                  <div className="bg-secondary rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold">
                      {selectedCustomer.reliability_score || 100}%
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Reliability
                    </div>
                  </div>
                </div>

                {/* Health Score Breakdown */}
                {(() => {
                  const health = calculateHealthScore(selectedCustomer);
                  return (
                    <div className="bg-muted/50 rounded-xl p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Heart className="h-5 w-5 text-primary" />
                        Health Score Breakdown
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Recency (Last Visit)</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-green-500" 
                                style={{ width: `${(health.breakdown.recency / 40) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8">{health.breakdown.recency}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Frequency (Visit Count)</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500" 
                                style={{ width: `${(health.breakdown.frequency / 30) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8">{health.breakdown.frequency}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Reliability Score</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-yellow-500" 
                                style={{ width: `${(health.breakdown.reliability / 20) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8">{health.breakdown.reliability}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Engagement</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-purple-500" 
                                style={{ width: `${(health.breakdown.engagement / 10) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8">{health.breakdown.engagement}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Last Visit */}
                {selectedCustomer.last_visit_date && (
                  <div className="flex items-center gap-3 text-lg bg-muted/50 p-4 rounded-lg">
                    <Calendar className="h-6 w-6 text-muted-foreground" />
                    <span className="text-muted-foreground">Last visit:</span>
                    <span className="font-medium">
                      {new Date(selectedCustomer.last_visit_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </span>
                  </div>
                )}

                {/* Birthday */}
                {selectedCustomer.birthday && (
                  <div className="flex items-center gap-3 text-lg bg-pink-50 p-4 rounded-lg">
                    <span className="text-2xl">🎂</span>
                    <span className="text-muted-foreground">Birthday:</span>
                    <span className="font-medium">
                      {new Date(selectedCustomer.birthday).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                )}

                {/* Contact Info */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Contact</h3>
                  <div className="text-xl space-y-2">
                    <div className="flex items-center gap-3">
                      <Phone className="h-6 w-6 text-muted-foreground" />
                      <span className="font-medium">{selectedCustomer.phone}</span>
                    </div>
                    {selectedCustomer.email && (
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">@</span>
                        <span className="font-medium">
                          {selectedCustomer.email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Tags</h3>
                  <div className="flex flex-wrap gap-3">
                    {editedTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant={tag === "VIP" ? "default" : "secondary"}
                        className="text-lg px-4 py-2 gap-2"
                      >
                        {tag}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTag(tag);
                          }}
                          className="hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <Input
                      placeholder="Add new tag..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                      className="text-lg py-6"
                    />
                    <Button
                      onClick={handleAddTag}
                      disabled={!newTag.trim()}
                      className="px-6"
                    >
                      <Plus className="h-6 w-6" />
                    </Button>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Notes</h3>
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes about this customer..."
                    className="min-h-[150px] text-lg leading-relaxed"
                  />
                </div>

                {/* Save Button */}
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="w-full py-6 text-xl font-bold"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* WhatsApp Modal */}
      {selectedCustomer && (
        <WhatsAppModal
          isOpen={isWhatsAppModalOpen}
          onClose={() => setIsWhatsAppModalOpen(false)}
          phoneNumber={selectedCustomer.phone}
          customerName={selectedCustomer.name}
          customerId={selectedCustomer.id}
          restaurantName={restaurantName}
        />
      )}

      {/* Bulk WhatsApp Modal */}
      <BulkWhatsAppModal
        isOpen={isBulkWhatsAppModalOpen}
        onClose={() => setIsBulkWhatsAppModalOpen(false)}
        customers={selectedCustomerObjects}
        restaurantName={restaurantName}
      />

      {/* Add Customer Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Name *</Label>
              <Input
                id="new-name"
                placeholder="Customer name"
                value={newCustomer.name}
                onChange={(e) => {
                  setNewCustomer({ ...newCustomer, name: e.target.value });
                  if (nameError) setNameError(null);
                }}
                className={`h-12 ${nameError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {nameError && (
                <p className="text-sm text-red-500">{nameError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-phone">Phone *</Label>
              <Input
                id="new-phone"
                placeholder="555-0101"
                value={newCustomer.phone}
                onChange={(e) => {
                  setNewCustomer({ ...newCustomer, phone: e.target.value });
                  if (phoneError) setPhoneError(null);
                }}
                className={`h-12 ${phoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {phoneError && (
                <p className="text-sm text-red-500">{phoneError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-email">Email (optional)</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="customer@email.com"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                className="h-12"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {newCustomer.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveNewCustomerTag(tag)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add tag..."
                  value={newCustomerTag}
                  onChange={(e) => setNewCustomerTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNewCustomerTag()}
                  className="h-10"
                />
                <Button
                  type="button"
                  onClick={handleAddNewCustomerTag}
                  disabled={!newCustomerTag.trim()}
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-notes">Notes</Label>
              <Textarea
                id="new-notes"
                placeholder="Any notes about this customer..."
                value={newCustomer.notes}
                onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                className="min-h-[80px]"
              />
            </div>

            <Button
              onClick={handleCreateCustomer}
              disabled={createMutation.isPending || !newCustomer.name.trim() || !newCustomer.phone.trim()}
              className="w-full h-12 text-lg font-bold"
            >
              {createMutation.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
