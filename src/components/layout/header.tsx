"use client";

import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { getProduct } from "@/lib/config/products";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();

  const slug = pathname.split("/").filter(Boolean)[0];
  const product = slug ? getProduct(slug) : null;

  const breadcrumb = product ? product.name : "Overview";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border/50 bg-card px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-1 hover:bg-accent lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          {product && (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: product.color }}
            />
          )}
          <h2 className="text-sm font-semibold">{breadcrumb}</h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DateRangePicker />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          title="Logout"
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
