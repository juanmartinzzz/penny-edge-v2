import { useState } from "react";
import { motion } from "framer-motion";
import { Sidebar, type NavId } from "./Sidebar";
import { HomePage } from "../pages/HomePage";
import "./AppShell.css";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [active, setActive] = useState<NavId>("overview");

  return (
    <div className="app-shell">
      <motion.div
        className="app-sidebar-slot"
        initial={false}
        animate={{ width: collapsed ? 72 : 260 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        style={{ overflow: "hidden" }}
      >
        <Sidebar
          collapsed={collapsed}
          active={active}
          onToggle={() => setCollapsed((value) => !value)}
          onNavigate={setActive}
        />
      </motion.div>

      <main className="app-main">
        <div className="app-topbar">
          <p className="app-topbar-title">{active}</p>
        </div>
        <div className="app-content">
          <HomePage section={active} />
        </div>
      </main>
    </div>
  );
}
