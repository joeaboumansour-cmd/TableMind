import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  Table, 
  MessageCircle, 
  Settings,
  Users,
  CreditCard
} from "lucide-react";

const settingsNav = [
  {
    title: "Tables",
    href: "/settings/tables",
    icon: Table,
    description: "Manage restaurant tables"
  },
  {
    title: "WhatsApp",
    href: "/settings/whatsapp",
    icon: MessageCircle,
    description: "Configure messaging"
  },
  // Future settings pages can be added here:
  // { title: "Profile", href: "/settings/profile", icon: Users },
  // { title: "Billing", href: "/settings/billing", icon: CreditCard },
  // { title: "General", href: "/settings/general", icon: Settings },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r bg-muted/40 hidden md:block">
        <div className="p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your restaurant
          </p>
        </div>
        <nav className="px-4 pb-4">
          <ul className="space-y-1">
            {settingsNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Mobile Navigation */}
      <div className="md:hidden border-b bg-background w-full">
        <nav className="flex overflow-x-auto px-4 py-2 gap-2">
          {settingsNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
