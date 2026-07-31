"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  checkedClass?: string;
  uncheckedClass?: string;
  label?: string;
}

export function Switch({
  checked = false,
  onCheckedChange,
  disabled = false,
  id,
  className,
  checkedClass = "bg-green-500",
  uncheckedClass = "bg-input",
  label,
}: SwitchProps) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
        "border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? checkedClass : uncheckedClass,
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
      {label && (
        <span className={`absolute inset-0 flex items-center justify-center text-xs font-medium ${
          checked ? "text-white" : "text-muted-foreground"
        }`}>
          {label}
        </span>
      )}
    </button>
  );
}
