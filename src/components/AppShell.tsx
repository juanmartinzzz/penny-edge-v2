import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Sidebar, pathToNavId } from "./Sidebar";
import "./AppShell.css";

const SIDEBAR_COLLAPSED_KEY = "penny-edge.sidebar.collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const { pathname } = useLocation();
  const active = pathToNavId(pathname);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      writeSidebarCollapsed(next);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <motion.div
        className="app-sidebar-slot"
        initial={false}
        animate={{ width: collapsed ? 72 : 260 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        style={{ overflow: "hidden" }}
      >
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
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
