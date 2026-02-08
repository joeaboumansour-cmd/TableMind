"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Utensils, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Call our custom login API
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Invalid username or password");
        return;
      }

      // Store auth token
      localStorage.setItem("tablemind_auth", JSON.stringify({
        token: data.token,
        user: data.user,
        restaurant: data.restaurant,
        timestamp: Date.now(),
      }));

      toast.success(`Welcome, ${data.user.display_name}!`);
      // Small delay to ensure localStorage is set before navigation
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 100);
    } catch (error) {
      toast.error("An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
          <Utensils className="h-7 w-7 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">TableMind</h1>
          <p className="text-muted-foreground">Restaurant Reservation System</p>
        </div>
      </div>

      <Card className="w-full max-w-md border-2">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Staff Login</CardTitle>
          <CardDescription>
            Enter your username and password to access your restaurant
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="e.g., bella_owner"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-12"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              <strong>Account created by admin</strong>
            </p>
            <p className="text-xs text-muted-foreground text-center mt-1">
              Contact your system administrator if you need access
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        © 2024 TableMind. All rights reserved.
      </p>
    </div>
  );
}
