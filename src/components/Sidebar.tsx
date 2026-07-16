import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Radar } from "lucide-react";
import { Button } from "./interaction/Button";
import "./Sidebar.css";

export type NavId = "overview" | "scanners";

type SidebarProps = {
  collapsed: boolean;
  active: NavId;
  onToggle: () => void;
  onNavigate: (id: NavId) => void;
};

const NAV_ITEMS: { id: NavId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "scanners", label: "Scanners", icon: Radar },
];

export function Sidebar({ collapsed, active, onToggle, onNavigate }: SidebarProps) {
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
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-link${active === id ? " is-active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-current={active === id ? "page" : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} strokeWidth={2.25} />
            <span className="sidebar-link-label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-footer-meta">Workers · D1 · Queues</p>
      </div>
    </aside>
  );
}
