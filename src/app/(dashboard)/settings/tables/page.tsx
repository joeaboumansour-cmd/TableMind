"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { useTables, useTableMutations } from "@/lib/hooks";
import { useRestaurant } from "@/app/RestaurantContext";
import type { Table, TableFormData } from "@/lib/types";

export default function TablesPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [newTable, setNewTable] = useState<TableFormData>({ 
    name: "", 
    capacity: 2, 
    shape: "rect" 
  });

  // Use RestaurantContext to get the logged-in user's restaurant
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.id || null;
  const { data: tables = [], isLoading } = useTables(restaurantId);
  const { createMutation, updateMutation, deleteMutation } = useTableMutations(restaurantId);

  const handleAddTable = () => {
    createMutation.mutate(newTable, {
      onSuccess: () => {
        setIsAddDialogOpen(false);
        setNewTable({ name: "", capacity: 2, shape: "rect" });
      },
    });
  };

  const handleEditTable = () => {
    if (!editingTable) return;
    updateMutation.mutate({
      id: editingTable.id,
      name: editingTable.name,
      capacity: editingTable.capacity,
      shape: editingTable.shape,
    }, {
      onSuccess: () => {
        setIsEditDialogOpen(false);
        setEditingTable(null);
      },
    });
  };

  const handleDeleteTable = (id: string) => {
    if (confirm("Are you sure you want to delete this table?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Floor Plan</h1>
          <p className="text-muted-foreground mt-1">
            Manage your restaurant tables and seating capacity
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Table
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Table</DialogTitle>
              <DialogDescription>
                Create a new table for your floor plan.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Table Name</Label>
                <Input
                  id="name"
                  value={newTable.name}
                  onChange={(e) => setNewTable({ ...newTable, name: e.target.value })}
                  placeholder="e.g., Table 5, Booth A"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="capacity">Capacity</Label>
                <Input
                  id="capacity"
                  type="number"
                  min={1}
                  max={50}
                  value={newTable.capacity}
                  onChange={(e) =>
                    setNewTable({ ...newTable, capacity: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Shape</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={newTable.shape === "rect" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewTable({ ...newTable, shape: "rect" })}
                  >
                    Rectangle
                  </Button>
                  <Button
                    type="button"
                    variant={newTable.shape === "circle" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewTable({ ...newTable, shape: "circle" })}
                  >
                    Circle
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddTable}
                disabled={!newTable.name || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Table"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tables Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6 h-40" />
            </Card>
          ))}
        </div>
      ) : tables.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No tables yet</h3>
          <p className="text-muted-foreground mb-4">
            Get started by adding your first table to the floor plan.
          </p>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Table
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tables.map((table: Table) => (
            <Card key={table.id} className="group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{table.name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {table.capacity} seats
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingTable(table);
                        setIsEditDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteTable(table.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`w-full h-24 bg-muted rounded-lg flex items-center justify-center ${
                    table.shape === "circle" ? "rounded-full" : "rounded-lg"
                  }`}
                >
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Table</DialogTitle>
            <DialogDescription>Update table details.</DialogDescription>
          </DialogHeader>
          {editingTable && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Table Name</Label>
                <Input
                  id="edit-name"
                  value={editingTable.name}
                  onChange={(e) =>
                    setEditingTable({ ...editingTable, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-capacity">Capacity</Label>
                <Input
                  id="edit-capacity"
                  type="number"
                  min={1}
                  max={50}
                  value={editingTable.capacity}
                  onChange={(e) =>
                    setEditingTable({
                      ...editingTable,
                      capacity: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Shape</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={editingTable.shape === "rect" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setEditingTable({ ...editingTable, shape: "rect" })}
                  >
                    Rectangle
                  </Button>
                  <Button
                    type="button"
                    variant={editingTable.shape === "circle" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setEditingTable({ ...editingTable, shape: "circle" })}
                  >
                    Circle
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditTable}
              disabled={!editingTable?.name || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
