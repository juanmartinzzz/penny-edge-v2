import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
} from "lucide-react";
import { AcronymLabel } from "./AcronymLabel";
import { Button } from "./interaction/Button";
import type { ProductAcronym } from "../lib/productNames";
import { PRODUCT_NAMES } from "../lib/productNames";
import "./Sidebar.css";

export type NavId = "overview" | "scanners" | "analysis";

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
];

export function pathToNavId(pathname: string): NavId {
  if (pathname === "/scanners" || pathname.startsWith("/scanners/")) {
    return "scanners";
  }
  if (pathname === "/analysis" || pathname.startsWith("/analysis/")) {
    return "analysis";
  }
  return "overview";
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden>
            P
          </span>
          <span className="sidebar-brand-text">Penny Edge</span>
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
        <p className="sidebar-footer-meta">Workers · D1 · Queues</p>
      </div>
    </aside>
  );
}
