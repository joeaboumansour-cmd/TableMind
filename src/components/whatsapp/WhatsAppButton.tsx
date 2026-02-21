"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface WhatsAppButtonProps {
  phoneNumber: string;
  customerName?: string;
  onClick?: (e?: React.MouseEvent) => void;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
  className?: string;
  showLabel?: boolean;
}

export function WhatsAppButton({
  phoneNumber,
  customerName,
  onClick,
  size = "default",
  variant = "default",
  className,
  showLabel = true,
}: WhatsAppButtonProps) {
  // Format phone number for WhatsApp
  const formatPhoneForWhatsApp = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    if (cleaned.length > 10) {
      return `+${cleaned}`;
    }
    return cleaned;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
      return;
    }

    // Direct WhatsApp link (opens WhatsApp Web or app)
    const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
    const greeting = customerName 
      ? `Hi ${customerName}, `
      : "Hi, ";
    const message = encodeURIComponent(`${greeting}`);
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${message}`;
    
    window.open(whatsappUrl, "_blank");
  };

  return (
    <Button
      onClick={handleClick}
      size={size}
      variant={variant}
      className={cn(
        "bg-[#25D366] hover:bg-[#128C7E] text-white",
        variant !== "default" && "bg-transparent text-[#25D366] hover:bg-[#25D366]/10 hover:text-[#128C7E]",
        className
      )}
    >
      <MessageCircle className={cn("h-4 w-4", showLabel && "mr-2")} />
      {showLabel && "WhatsApp"}
    </Button>
  );
}
