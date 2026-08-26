import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calculator,
  ArrowLeftRight,
  FileBarChart,
  Settings as SettingsIcon,
  ShieldCheck,
  ClipboardList,
  BookOpen,
} from "lucide-react";
import { cn } from "../lib/cn";

const nav = [
  { to: "/", label: "داشبورد", icon: LayoutDashboard, end: true },
  { to: "/members", label: "اعضا", icon: Users },
  { to: "/portfolio", label: "پرتفوی", icon: Briefcase },
  { to: "/nav", label: "محاسبه NAV", icon: Calculator },
  { to: "/transactions", label: "تراکنش‌ها", icon: ArrowLeftRight },
  { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
  { to: "/audit", label: "جزئیات محاسبات", icon: ClipboardList },
  { to: "/glossary", label: "راهنما و واژه‌نامه", icon: BookOpen },
  { to: "/settings", label: "تنظیمات", icon: SettingsIcon },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-shrink-0 border-l border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="rounded-lg bg-brand-600 p-2 text-white">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">سودیار</div>
            <div className="text-xs text-slate-400">مدیریت سرمایه گروهی</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-50"
                )
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 text-[11px] leading-5 text-slate-400">
          مدل واحد/NAV — همه محاسبات از روی تراکنش‌ها بازسازی می‌شوند.
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Mobile top nav */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
