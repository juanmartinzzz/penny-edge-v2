import { NavLink } from "react-router-dom";
import {
  Eye,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Sun,
  Thermometer,
} from "lucide-react";
import { AcronymLabel } from "./AcronymLabel";
import { Button } from "./interaction/Button";
import { PennyEdgeMark, PennyEdgeWordmark } from "./PennyEdgeLogo";
import type { ProductAcronym } from "../lib/productNames";
import { PRODUCT_NAMES } from "../lib/productNames";
import { useTheme } from "../lib/theme";
import "./Sidebar.css";

export type NavId =
  | "overview"
  | "scanners"
  | "analysis"
  | "temperature"
  | "swatch"
  | "future-features";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

type NavItem = {
  id: NavId;
  path: string;
  icon: typeof LayoutDashboard;
} & ({ label: string; acronym?: never } | { acronym: ProductAcronym; label?: never });

const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", path: "/", icon: LayoutDashboard },
  { id: "scanners", acronym: "EVG", path: "/scanners", icon: Radar },
  { id: "analysis", acronym: "TAS", path: "/analysis", icon: LineChart },
  { id: "temperature", acronym: "HIS", path: "/temperature", icon: Thermometer },
  { id: "swatch", acronym: "SWATCH", path: "/swatch", icon: Eye },
  {
    id: "future-features",
    label: "Future Features",
    path: "/future-features",
    icon: Lightbulb,
  },
];

export function pathToNavId(pathname: string): NavId {
  if (pathname === "/scanners" || pathname.startsWith("/scanners/")) {
    return "scanners";
  }
  if (pathname === "/analysis" || pathname.startsWith("/analysis/")) {
    return "analysis";
  }
  if (pathname === "/temperature" || pathname.startsWith("/temperature/")) {
    return "temperature";
  }
  if (pathname === "/swatch" || pathname.startsWith("/swatch/")) {
    return "swatch";
  }
  if (
    pathname === "/future-features" ||
    pathname.startsWith("/future-features/")
  ) {
    return "future-features";
  }
  return "overview";
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <PennyEdgeMark className="sidebar-brand-mark" />
          <PennyEdgeWordmark className="sidebar-brand-wordmark" />
        </div>
        <Button
          variant="ghost"
          iconOnly
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </Button>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const { id, path, icon: Icon } = item;
          const title = item.acronym
            ? `${item.acronym} · ${PRODUCT_NAMES[item.acronym]}`
            : item.label;

          return (
            <NavLink
              key={id}
              to={path}
              end={path === "/"}
              className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
              title={collapsed ? title : undefined}
            >
              <Icon size={18} strokeWidth={2.25} />
              <span className="sidebar-link-label">
                {item.acronym ? (
                  <AcronymLabel acronym={item.acronym} />
                ) : (
                  <span className="sidebar-link-acronym">{item.label}</span>
                )}
              </span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <Button
          variant="ghost"
          className="sidebar-theme-toggle"
          iconOnly={collapsed}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <Sun size={18} strokeWidth={2.25} />
          ) : (
            <Moon size={18} strokeWidth={2.25} />
          )}
          {!collapsed ? (
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          ) : null}
        </Button>
      </div>
    </aside>
  );
}
