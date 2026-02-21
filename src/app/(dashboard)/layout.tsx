"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useRestaurant } from "../RestaurantContext";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Settings,
  LogOut,
  Table,
  Loader2,
  BarChart3,
  Menu,
  X,
  List,
  Grid3X3,
  ChefHat,
} from "lucide-react";
import { LogoIcon } from "@/components/Logo";
import Link from "next/link";
import { getNavItemsForRole, canAccessRoute, UserRole } from "@/lib/auth/roles";
import { NavItem } from "@/lib/auth/roles";

// Icon mapping for role-based nav items
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  BarChart3,
  Calendar,
  List,
  Users,
  Grid3X3,
  ChefHat,
  Table,
  Settings,
};

// Convert role-based nav items to component format
function getNavItemsWithIcons(role: UserRole) {
  const items = getNavItemsForRole(role);
  return items.map(item => ({
    ...item,
    icon: iconMap[item.icon] || LayoutDashboard,
  }));
}

// Bottom nav items for mobile (first 5 items only)
function getMobileNavItems(role: UserRole) {
  return getNavItemsWithIcons(role).slice(0, 5);
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, restaurant, isLoading, signOut } = useRestaurant();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Get role-based nav items
  const navItems = user ? getNavItemsWithIcons(user.role) : [];
  const mobileNavItems = user ? getMobileNavItems(user.role) : [];

  useEffect(() => {
    if (isLoading) return;

    // Redirect to login if not authenticated
    if (!user) {
      router.push("/login");
      return;
    }

    // Redirect waiters to waiter view
    if (user.role === "waiter") {
      router.push("/waiter");
      return;
    }

    // Check if user can access current route
    if (pathname && !canAccessRoute(user.role, pathname)) {
      router.push("/dashboard");
      return;
    }
  }, [isLoading, user, pathname, router]);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render dashboard for waiters (they get redirected)
  if (!user || !restaurant || user.role === "waiter") {
    return null;
  }

  const NavContent = ({ onItemClick }: { onItemClick?: () => void }) => (
    <>
      <div className="p-4 lg:p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <LogoIcon size="sm" className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-base lg:text-lg truncate">
              {restaurant.name}
            </h1>
            <p className="text-xs text-muted-foreground">GoldenSquirrel</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 lg:p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onItemClick}
              className="flex items-center gap-3 px-3 py-3 lg:py-2 rounded-lg text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        <div className="px-3 py-2">
          <p className="text-sm font-medium truncate">{user.display_name}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {user.role} • {restaurant.subscription_tier}
          </p>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden lg:flex fixed left-0 top-0 z-40 w-64 h-screen border-r border-border bg-card flex-col">
        <NavContent />
      </aside>

      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-card border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <LogoIcon size="sm" />
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate max-w-[150px]">
              {restaurant.name}
            </h1>
            <p className="text-xs text-muted-foreground">GoldenSquirrel</p>
          </div>
        </div>

        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] p-0 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="font-semibold">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <NavContent onItemClick={() => setIsMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>

      <main className="lg:ml-64 pt-16 lg:pt-0 min-h-screen overflow-auto">
        {children}
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-card border-t border-border flex items-center justify-around px-2">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-1 p-2 min-w-[60px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="lg:hidden h-16" />
    </div>
  );
}
