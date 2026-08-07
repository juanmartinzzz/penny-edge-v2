import { useEffect, useId, useState } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Moon, Sun, X } from "lucide-react";
import { AcronymLabel } from "./AcronymLabel";
import { Button } from "./interaction/Button";
import { PennyEdgeWordmark } from "./PennyEdgeLogo";
import { NAV_ITEMS } from "./navItems";
import { PRODUCT_NAMES } from "../lib/productNames";
import { useTheme } from "../lib/theme";
import "./MobileNav.css";

const sheetSpring = { type: "spring" as const, stiffness: 380, damping: 36 };
const fadeTransition = { duration: 0.2 };

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const titleId = useId();
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <div className="mobile-nav">
      <motion.div
        className="mobile-nav-fab-wrap"
        initial={false}
        animate={{ scale: open ? 0.92 : 1 }}
        transition={sheetSpring}
      >
        <Button
          variant="primary"
          className="mobile-nav-fab"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? "close" : "menu"}
              className="mobile-nav-fab-icon"
              initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
              transition={{ duration: 0.15 }}
            >
              {open ? <X size={22} strokeWidth={2.4} /> : <Menu size={22} strokeWidth={2.4} />}
            </motion.span>
          </AnimatePresence>
        </Button>
      </motion.div>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              className="mobile-nav-backdrop"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
              onClick={close}
            />
            <motion.div
              id={dialogId}
              className="mobile-nav-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={sheetSpring}
            >
              <div className="mobile-nav-sheet-handle" aria-hidden="true" />
              <div className="mobile-nav-sheet-header">
                <PennyEdgeWordmark className="mobile-nav-wordmark" />
                <p id={titleId} className="mobile-nav-sheet-title">
                  Menu
                </p>
              </div>

              <nav className="mobile-nav-links" aria-label="Primary">
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
                      className={({ isActive }) =>
                        `mobile-nav-link${isActive ? " is-active" : ""}`
                      }
                      title={title}
                      onClick={close}
                    >
                      <Icon size={20} strokeWidth={2.25} />
                      <span className="mobile-nav-link-label">
                        {item.acronym ? (
                          <AcronymLabel acronym={item.acronym} />
                        ) : (
                          <span className="mobile-nav-link-text">{item.label}</span>
                        )}
                      </span>
                    </NavLink>
                  );
                })}
              </nav>

              <div className="mobile-nav-sheet-footer">
                <Button
                  variant="ghost"
                  className="mobile-nav-theme-toggle"
                  aria-label={
                    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
                  }
                  onClick={toggleTheme}
                >
                  {theme === "dark" ? (
                    <Sun size={18} strokeWidth={2.25} />
                  ) : (
                    <Moon size={18} strokeWidth={2.25} />
                  )}
                  <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                </Button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
