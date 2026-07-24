import * as React from "react"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  value,
  onValueChange,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex", className)} {...props} />
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }