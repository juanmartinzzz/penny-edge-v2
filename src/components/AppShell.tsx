import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Sidebar, pathToNavId } from "./Sidebar";
import "./AppShell.css";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const active = pathToNavId(pathname);

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
          onToggle={() => setCollapsed((value) => !value)}
        />
      </motion.div>

      <main className="app-main">
        <div className="app-topbar">
          <p className="app-topbar-title">{active}</p>
        </div>
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
