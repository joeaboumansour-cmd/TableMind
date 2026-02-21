"use client";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: { container: "h-8 w-8", icon: "h-5 w-5", text: "text-xl" },
  md: { container: "h-10 w-10", icon: "h-6 w-6", text: "text-2xl" },
  lg: { container: "h-12 w-12", icon: "h-7 w-7", text: "text-3xl" },
};

export function Logo({ className, iconOnly = false, size = "md" }: LogoProps) {
  const classes = sizeClasses[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "rounded-xl bg-amber-500 flex items-center justify-center shadow-lg",
          classes.container
        )}
      >
        <svg
          viewBox="0 0 32 32"
          className={cn("text-white", classes.icon)}
          fill="currentColor"
        >
          {/* Golden Squirrel - Side Profile Style */}
          {/* Body */}
          <ellipse cx="18" cy="22" rx="6" ry="7" />
          {/* Head */}
          <circle cx="24" cy="14" r="5" />
          {/* Snout */}
          <ellipse cx="28" cy="15" rx="3" ry="2.5" />
          {/* Ear */}
          <path d="M22 10 L24 6 L26 10 Z" />
          {/* Eye */}
          <circle cx="25" cy="13" r="1.2" fill="#FEF3C7" />
          {/* Front paws */}
          <ellipse cx="22" cy="20" rx="2" ry="3" />
          {/* Hind leg */}
          <ellipse cx="14" cy="24" rx="2.5" ry="4" />
          {/* Big curly tail */}
          <path d="M12 20 
                   C 8 18, 6 14, 6 10 
                   C 6 4, 10 2, 14 4 
                   C 17 5, 18 8, 16 10 
                   C 14 12, 11 10, 12 8 
                   C 12 6, 14 6, 15 7
                   C 16 8, 16 10, 14 12
                   C 12 14, 10 16, 12 20 Z" />
          {/* Tail inner highlight */}
          <path d="M10 14 
                   C 9 12, 9 8, 11 6 
                   C 13 5, 14 6, 13 8 
                   C 12 9, 11 8, 11 7" 
                fill="none" 
                stroke="white" 
                strokeWidth="1.5"
                opacity="0.6"
                strokeLinecap="round"/>
        </svg>
      </div>
      {!iconOnly && (
        <span className={cn("font-bold bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent", classes.text)}>
          GoldenSquirrel
        </span>
      )}
    </div>
  );
}

export function LogoIcon({ className, size = "md" }: Omit<LogoProps, "iconOnly">) {
  const classes = sizeClasses[size];

  return (
    <div
      className={cn(
        "rounded-xl bg-amber-500 flex items-center justify-center shadow-lg",
        classes.container,
        className
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className={cn("text-white", classes.icon)}
        fill="currentColor"
      >
        {/* Golden Squirrel - Side Profile Style */}
        {/* Body */}
        <ellipse cx="18" cy="22" rx="6" ry="7" />
        {/* Head */}
        <circle cx="24" cy="14" r="5" />
        {/* Snout */}
        <ellipse cx="28" cy="15" rx="3" ry="2.5" />
        {/* Ear */}
        <path d="M22 10 L24 6 L26 10 Z" />
        {/* Eye */}
        <circle cx="25" cy="13" r="1.2" fill="#FEF3C7" />
        {/* Front paws */}
        <ellipse cx="22" cy="20" rx="2" ry="3" />
        {/* Hind leg */}
        <ellipse cx="14" cy="24" rx="2.5" ry="4" />
        {/* Big curly tail */}
        <path d="M12 20 
                 C 8 18, 6 14, 6 10 
                 C 6 4, 10 2, 14 4 
                 C 17 5, 18 8, 16 10 
                 C 14 12, 11 10, 12 8 
                 C 12 6, 14 6, 15 7
                 C 16 8, 16 10, 14 12
                 C 12 14, 10 16, 12 20 Z" />
        {/* Tail inner highlight */}
        <path d="M10 14 
                 C 9 12, 9 8, 11 6 
                 C 13 5, 14 6, 13 8 
                 C 12 9, 11 8, 11 7" 
              fill="none" 
              stroke="white" 
              strokeWidth="1.5"
              opacity="0.6"
              strokeLinecap="round"/>
      </svg>
    </div>
  );
}
