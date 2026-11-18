"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  Home,
  Building2,
  FileText,
  Users,
  Menu,
  X,
  Settings,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth";
import { getSettings, SYNC_EVENT } from "@/lib/store";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useCompanyName() {
  const [company, setCompany] = useState("DClean");
  useEffect(() => {
    const sync = () => setCompany(getSettings().company_name.trim() || "DClean");
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, []);
  return company;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  const company = useCompanyName();
  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicon.svg"
        alt=""
        width={compact ? 36 : 40}
        height={compact ? 36 : 40}
        className={cn(
          "shrink-0 rounded-xl shadow-sm",
          compact ? "h-9 w-9" : "h-10 w-10"
        )}
      />
      <div className="flex flex-col items-start leading-none min-w-0">
        <span
          className={cn(
            "font-black tracking-tight text-slate-900",
            compact ? "text-lg" : "text-xl"
          )}
        >
          ArkaTasks
        </span>
        <span className="mt-0.5 text-xs font-semibold tracking-wider uppercase text-slate-400 truncate">
          {company}
        </span>
      </div>
    </div>
  );
}

function useSignOut() {
  const router = useRouter();
  return () => {
    logout();
    router.replace("/");
    window.location.reload();
  };
}

function usePrefetchAppRoutes() {
  const router = useRouter();
  useEffect(() => {
    for (const item of navItems) {
      void router.prefetch(item.href);
    }
  }, [router]);
}

export function Sidebar() {
  const pathname = usePathname();
  const signOut = useSignOut();
  const company = useCompanyName();
  usePrefetchAppRoutes();

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-white shadow-sm">
      <div className="flex h-16 items-center border-b px-4">
        <BrandMark />
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            pathname === `${item.href}/` ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-teal-50 text-teal-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive ? "text-teal-600" : "text-slate-400")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 space-y-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
        <p className="text-xs text-slate-400 text-center">ArkaTasks · {company}</p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const signOut = useSignOut();
  usePrefetchAppRoutes();

  return (
    <header className="lg:hidden sticky top-0 z-40 border-b bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between px-4 gap-2">
        <BrandMark compact />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>
      {open && (
        <nav className="border-t bg-white p-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              pathname === `${item.href}/` ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  isActive ? "bg-teal-50 text-teal-700" : "text-slate-600"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
