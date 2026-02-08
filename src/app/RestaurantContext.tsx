"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";

interface Restaurant {
  id: string;
  private_id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  timezone: string;
  settings: {
    opening_time: string;
    closing_time: string;
    slot_duration_minutes: number;
    default_reservation_duration: number;
    max_party_size: number;
  };
}

interface User {
  id: string;
  username: string;
  display_name: string;
  role: "owner" | "manager" | "host" | "waiter" | "admin";
}

interface RestaurantContextType {
  user: User | null;
  restaurant: Restaurant | null;
  token: string | null;
  isLoading: boolean;
  signOut: () => void;
  isAuthenticated: boolean;
}

const RestaurantContext = createContext<RestaurantContextType>({
  user: null,
  restaurant: null,
  token: null,
  isLoading: true,
  signOut: () => {},
  isAuthenticated: false,
});

interface JWTPayload {
  userId: string;
  restaurantId: string;
  username: string;
  role: string;
  exp: number;
}

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load auth from localStorage on mount
  useEffect(() => {
    const loadAuth = () => {
      try {
        const authData = localStorage.getItem("tablemind_auth");
        if (!authData) {
          setIsLoading(false);
          return;
        }

        const parsed = JSON.parse(authData);
        
        // Check if token is expired
        if (parsed.token) {
          const decoded = jwtDecode<JWTPayload>(parsed.token);
          if (decoded.exp * 1000 < Date.now()) {
            // Token expired
            localStorage.removeItem("tablemind_auth");
            setIsLoading(false);
            return;
          }
        }

        // Valid session
        setToken(parsed.token);
        setUser(parsed.user);
        setRestaurant(parsed.restaurant);
      } catch (error) {
        console.error("Auth load error:", error);
        localStorage.removeItem("tablemind_auth");
      } finally {
        setIsLoading(false);
      }
    };

    loadAuth();

    // Listen for storage changes (for multi-tab support)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "tablemind_auth") {
        if (!e.newValue) {
          // Logged out in another tab
          setToken(null);
          setUser(null);
          setRestaurant(null);
        } else {
          // Logged in in another tab
          const parsed = JSON.parse(e.newValue);
          setToken(parsed.token);
          setUser(parsed.user);
          setRestaurant(parsed.restaurant);
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const signOut = () => {
    localStorage.removeItem("tablemind_auth");
    setToken(null);
    setUser(null);
    setRestaurant(null);
  };

  return (
    <RestaurantContext.Provider
      value={{
        user,
        restaurant,
        token,
        isLoading,
        signOut,
        isAuthenticated: !!token && !!user && !!restaurant,
      }}
    >
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  return useContext(RestaurantContext);
}
