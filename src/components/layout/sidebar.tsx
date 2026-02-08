"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Globe, Link2, Flame, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/config/site";
import { products } from "@/lib/config/products";

const productIcons: Record<string, React.ReactNode> = {
  somara: <Globe className="h-4 w-4" />,
  ulink: <Link2 className="h-4 w-4" />,
  pushfire: <Flame className="h-4 w-4" />,
};

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "Overview",
      icon: <BarChart3 className="h-4 w-4" />,
    },
    ...products.map((p) => ({
      href: `/${p.slug}`,
      label: p.name,
      icon: productIcons[p.slug],
      color: p.color,
    })),
  ];

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border/50 bg-card transition-transform duration-200 lg:relative lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border/50 px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
            <BarChart3 className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight">
            {siteConfig.name}
          </span>
        </Link>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-accent lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <span
                style={
                  "color" in item
                    ? { color: item.color }
                    : isActive
                      ? { color: "#818cf8" }
                      : undefined
                }
              >
                {item.icon}
              </span>
              {item.label}
              {"color" in item && (
                <span
                  className="ml-auto h-2.5 w-2.5 rounded-full ring-2 ring-background"
                  style={{ backgroundColor: item.color }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border/50 px-3 py-4">
        <p className="text-xs text-muted-foreground/60">
          Flywheel Command Center v1.0
        </p>
      </div>
    </aside>
  );
}
