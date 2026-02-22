"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  DndContext,
  useDraggable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useRestaurant } from "@/app/RestaurantContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  Clock,
  Calendar,
  GripVertical,
  Settings,
  Plus,
  Save,
  RotateCcw,
  Maximize,
} from "lucide-react";
import { useUnifiedData, getAvailabilityColor, UnifiedTable } from "@/lib/hooks/useUnifiedData";
import type { Reservation } from "@/lib/types";
import { toast } from "sonner";

// Type alias for backward compatibility
type Table = UnifiedTable;

interface FloorPlanProps {
  onTableClick?: (table: Table) => void;
  selectedDate?: string;
  readOnly?: boolean;
}

interface DraggableTableProps {
  table: Table;
  reservation?: Reservation;
  isEditing: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  onResize?: (width: number, height: number) => void;
}

const GRID_SIZE = 20; // Snap to grid pixels
const MIN_WIDTH = 60;
const MIN_HEIGHT = 60;
const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 80;

// Resize handle component
function ResizeHandle({ 
  onResize, 
  table 
}: { 
  onResize: (width: number, height: number) => void;
  table: Table;
}) {
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: table.width || DEFAULT_WIDTH, height: table.height || DEFAULT_HEIGHT });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { 
      width: table.width || DEFAULT_WIDTH, 
      height: table.height || DEFAULT_HEIGHT 
    };
  }, [table.width, table.height]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;
      
      const newWidth = Math.max(MIN_WIDTH, Math.round((startSize.current.width + deltaX) / GRID_SIZE) * GRID_SIZE);
      const newHeight = Math.max(MIN_HEIGHT, Math.round((startSize.current.height + deltaY) / GRID_SIZE) * GRID_SIZE);
      
      onResize(newWidth, newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full cursor-nwse-resize flex items-center justify-center shadow-md hover:scale-110 transition-transform z-20"
      style={{ transform: 'translate(50%, 50%)' }}
    >
      <Maximize className="w-2 h-2 text-white" />
    </div>
  );
}

function DraggableTableCard({
  table,
  reservation,
  isEditing,
  onClick,
  style,
  onResize,
}: DraggableTableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: table.id,
    disabled: !isEditing,
    data: { table },
  });

  const dragStyle = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : 10,
      }
    : undefined;

  const width = table.width || DEFAULT_WIDTH;
  const height = table.height || DEFAULT_HEIGHT;

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "seated":
        return "bg-red-500 border-red-600";
      case "booked":
      case "confirmed":
        return "bg-amber-400 border-amber-500";
      default:
        return "bg-green-500 border-green-600";
    }
  };

  const getTableShape = () => {
    if (table.shape === "circle") {
      return "rounded-full aspect-square";
    }
    return "rounded-lg";
  };

  // When not editing, render without dnd-kit attributes to allow proper clicking
  if (!isEditing) {
    return (
      <div
        style={{ ...style, width, height }}
        className="absolute cursor-pointer"
        onClick={onClick}
      >
        <Card
          className={`
            ${getTableShape()}
            ${getStatusColor(reservation?.status)}
            w-full h-full
            flex flex-col items-center justify-center 
            text-white border-2 shadow-lg
            transition-all hover:scale-105
            ${reservation?.status === "seated" ? "animate-pulse" : ""}
          `}
        >
          <span className="font-bold text-sm text-center px-1 truncate w-full">
            {table.name}
          </span>
          <div className="flex items-center gap-1 text-xs mt-1">
            <Users className="w-3 h-3" />
            <span>{table.capacity}</span>
          </div>
          {reservation && (
            <div className="absolute -bottom-6 left-0 right-0 text-center">
              <Badge
                variant="secondary"
                className="text-[10px] px-1 whitespace-nowrap"
              >
                {reservation.customer_name.length > 10
                  ? reservation.customer_name.slice(0, 10) + "..."
                  : reservation.customer_name}
              </Badge>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // When editing, use dnd-kit for dragging
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...dragStyle, width, height }}
      className={`absolute ${isDragging ? "opacity-80" : ""}`}
      {...attributes}
    >
      <Card
        className={`
          ${getTableShape()}
          ${getStatusColor(reservation?.status)}
          w-full h-full
          flex flex-col items-center justify-center 
          cursor-grab
          text-white border-2 shadow-lg
          transition-all hover:scale-105
          ${reservation?.status === "seated" ? "animate-pulse" : ""}
        `}
      >
        {/* Drag handle */}
        <div
          {...listeners}
          className="absolute top-1 right-1 p-1 cursor-grab active:cursor-grabbing hover:bg-white/20 rounded"
        >
          <GripVertical className="w-4 h-4 text-white/80" />
        </div>
        
        {/* Resize handle */}
        {onResize && <ResizeHandle table={table} onResize={onResize} />}
        
        <span className="font-bold text-sm text-center px-1 truncate w-full">
          {table.name}
        </span>
        <div className="flex items-center gap-1 text-xs mt-1">
          <Users className="w-3 h-3" />
          <span>{table.capacity}</span>
        </div>
        <div className="text-[10px] mt-1 opacity-75">
          {width}×{height}
        </div>
        {reservation && (
          <div className="absolute -bottom-6 left-0 right-0 text-center">
            <Badge
              variant="secondary"
              className="text-[10px] px-1 whitespace-nowrap"
            >
              {reservation.customer_name.length > 10
                ? reservation.customer_name.slice(0, 10) + "..."
                : reservation.customer_name}
            </Badge>
          </div>
        )}
      </Card>
    </div>
  );
}

export function FloorPlan({
  onTableClick,
  selectedDate,
  readOnly = false,
}: FloorPlanProps) {
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const today = selectedDate || new Date().toISOString().split("T")[0];

  // Mouse and touch sensors for drag detection
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  // Use unified data hook - single source of truth
  const { 
    tables, 
    tablesWithReservations,
    reservations,
    isLoading: tablesLoading 
  } = useUnifiedData({ 
    date: today,
    enableRealtime: true 
  });

  // Create a lookup map for reservations by table (for backward compatibility)
  const tableReservations = useMemo(() => {
    const map = new Map<string, Reservation>();
    tablesWithReservations.forEach((twr) => {
      if (twr.reservation) {
        map.set(twr.id, twr.reservation as Reservation);
      }
    });
    return map;
  }, [tablesWithReservations]);

  // Mutation to update table position
  const updatePositionMutation = useMutation({
    mutationFn: async ({
      tableId,
      x,
      y,
    }: {
      tableId: string;
      x: number;
      y: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("tables")
        .update({ x_position: x, y_position: y })
        .eq("id", tableId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-plan-tables"] });
    },
  });

  // Mutation to update table size
  const updateSizeMutation = useMutation({
    mutationFn: async ({
      tableId,
      width,
      height,
    }: {
      tableId: string;
      width: number;
      height: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("tables")
        .update({ width, height })
        .eq("id", tableId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-plan-tables"] });
    },
  });

  // Handle resize
  const handleResize = useCallback((tableId: string, width: number, height: number) => {
    // Optimistic update
    queryClient.setQueryData(
      ["floor-plan-tables", restaurantId],
      (old: Table[] | undefined) => {
        if (!old) return old;
        return old.map((t: Table) =>
          t.id === tableId ? { ...t, width, height } : t
        );
      }
    );

    // Debounce the save
    const timeoutId = setTimeout(() => {
      updateSizeMutation.mutate({ tableId, width, height });
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [queryClient, restaurantId, updateSizeMutation]);

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, delta } = event;
    
    if (!delta) return;

    const table = tables.find((t: Table) => t.id === active.id);
    if (!table) return;

    // Calculate new position with grid snapping
    const currentX = table.x_position || 0;
    const currentY = table.y_position || 0;
    
    const newX = Math.round((currentX + delta.x) / GRID_SIZE) * GRID_SIZE;
    const newY = Math.round((currentY + delta.y) / GRID_SIZE) * GRID_SIZE;

    // Keep within bounds
    const boundedX = Math.max(0, newX);
    const boundedY = Math.max(0, newY);

    // Optimistic update
    queryClient.setQueryData(
      ["floor-plan-tables", restaurantId],
      (old: Table[] | undefined) => {
        if (!old) return old;
        return old.map((t) =>
          t.id === table.id ? { ...t, x_position: boundedX, y_position: boundedY } : t
        );
      }
    );

    // Save to database
    updatePositionMutation.mutate({ tableId: table.id, x: boundedX, y: boundedY });
  };

  // Save all positions
  const handleSaveLayout = () => {
    setIsEditing(false);
    toast.success("Floor plan layout saved");
  };

  // Reset positions (auto-layout)
  const handleAutoLayout = () => {
    const cols = Math.ceil(Math.sqrt(tables.length));
    const spacingX = 140;
    const spacingY = 120;

    tables.forEach((table: Table, index: number) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const newX = col * spacingX + 20;
      const newY = row * spacingY + 20;

      updatePositionMutation.mutate({
        tableId: table.id,
        x: newX,
        y: newY,
      });
    });

    toast.success("Auto-layout applied");
  };

  const activeTable = activeId ? tables.find((t: Table) => t.id === activeId) : null;

  if (tablesLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] text-muted-foreground">
        <Settings className="w-16 h-16 mb-4" />
        <p className="text-lg">No tables configured</p>
        <p className="text-sm">Add tables in Settings → Tables first</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-green-500 rounded" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-amber-400 rounded" />
              <span>Reserved</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-red-500 rounded" />
              <span>Occupied</span>
            </div>
          </div>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoLayout}
                  disabled={updatePositionMutation.isPending}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Auto Layout
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveLayout}
                  disabled={updatePositionMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Done Editing
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <GripVertical className="w-4 h-4 mr-2" />
                Edit Layout
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Floor Plan Canvas */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="relative bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20 overflow-auto"
          style={{ height: "600px", minWidth: "100%" }}
        >
          {/* Grid background */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgb(226 232 240) 1px, transparent 1px),
                linear-gradient(to bottom, rgb(226 232 240) 1px, transparent 1px)
              `,
              backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            }}
          />

          {/* Tables */}
          {tables.map((table: Table) => (
            <DraggableTableCard
              key={table.id}
              table={table}
              reservation={tableReservations.get(table.id)}
              isEditing={isEditing && !readOnly}
              onClick={() => onTableClick?.(table)}
              style={{
                left: `${table.x_position || 0}px`,
                top: `${table.y_position || 0}px`,
              }}
              onResize={isEditing ? (w, h) => handleResize(table.id, w, h) : undefined}
            />
          ))}

          {/* Drag overlay for smooth dragging */}
          <DragOverlay>
            {activeTable ? (
              <Card
                className={`
                  ${activeTable.shape === "circle" ? "rounded-full aspect-square" : "rounded-lg"}
                  w-[100px] h-[80px] 
                  flex flex-col items-center justify-center 
                  bg-blue-500 border-blue-600
                  text-white border-2 shadow-xl
                  cursor-grabbing
                `}
              >
                <span className="font-bold text-sm text-center px-1">
                  {activeTable.name}
                </span>
                <div className="flex items-center gap-1 text-xs mt-1">
                  <Users className="w-3 h-3" />
                  <span>{activeTable.capacity}</span>
                </div>
              </Card>
            ) : null}
          </DragOverlay>
        </div>
      </DndContext>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Total Tables: {tables.length}</span>
          <span>Occupied: {reservations.filter((r: Reservation) => r.status === "seated").length}</span>
          <span>Reserved: {reservations.filter((r: Reservation) => ["booked", "confirmed"].includes(r.status)).length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-4 h-4" />
          <span>{today}</span>
        </div>
      </div>
    </div>
  );
}

export default FloorPlan;
