import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Database, Shield, Zap } from "lucide-react";
import { Button } from "../components/interaction/Button";
import type { NavId } from "../components/Sidebar";
import { apiFetch } from "../lib/api";
import "./HomePage.css";

type HomePageProps = {
  section: NavId;
};

type HealthResponse = {
  ok: boolean;
  service: string;
  time: string;
};

const COPY: Record<NavId, { title: string; lede: string }> = {
  overview: {
    title: "Bold edge ops, stripped to black and white.",
    lede: "Penny Edge is a monochrome workspace for clear decisions. This demo page shows the layout, motion, and interaction basics.",
  },
  insights: {
    title: "Signals without the noise.",
    lede: "Insight panels will land here later. For now, this is placeholder content to prove the shell and typography rhythm.",
  },
  settings: {
    title: "Keep the system sharp.",
    lede: "Settings will manage Workers, D1, and deploy preferences. The shell is ready; wire them when you are.",
  },
};

const PANELS = [
  {
    icon: Zap,
    title: "Fast shell",
    body: "Vite + React with Framer Motion for the sidebar collapse and page entrance.",
  },
  {
    icon: Database,
    title: "Prod API",
    body: "Local UI talks to the production penny-edge-api Worker over HTTPS — no local backend.",
  },
  {
    icon: Shield,
    title: "Pure CSS",
    body: "No Tailwind. Design tokens, fully rounded buttons, and bold Syne display type.",
  },
];

export function HomePage({ section }: HomePageProps) {
  const { title, lede } = COPY[section];
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  async function pingApi() {
    setApiLoading(true);
    setApiStatus(null);
    try {
      const data = await apiFetch<HealthResponse>("/health");
      setApiStatus(`${data.service} · ok · ${data.time}`);
    } catch (error) {
      setApiStatus(error instanceof Error ? error.message : "API request failed");
    } finally {
      setApiLoading(false);
    }
  }

  return (
    <motion.section
      key={section}
      className="home"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="home-hero">
        <p className="home-kicker">Penny Edge · demo</p>
        <h1 className="home-title">{title}</h1>
        <p className="home-lede">{lede}</p>
        <div className="home-actions">
          <Button>
            Get started
            <ArrowRight size={16} strokeWidth={2.5} />
          </Button>
          <Button variant="ghost" onClick={pingApi} disabled={apiLoading}>
            {apiLoading ? "Pinging API…" : "Ping prod API"}
          </Button>
        </div>
        {apiStatus ? <p className="home-api-status">{apiStatus}</p> : null}
      </header>

      <div className="home-grid">
        {PANELS.map(({ icon: Icon, title: panelTitle, body }, index) => (
          <motion.article
            key={panelTitle}
            className="home-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + index * 0.06, duration: 0.35 }}
          >
            <span className="home-panel-icon" aria-hidden>
              <Icon size={18} strokeWidth={2.25} />
            </span>
            <h3>{panelTitle}</h3>
            <p>{body}</p>
          </motion.article>
        ))}
      </div>

      <div className="home-strip">
        <div className="home-stat">
          <strong>01</strong>
          <span>Sidebar</span>
        </div>
        <div className="home-stat">
          <strong>∞</strong>
          <span>Rounded CTAs</span>
        </div>
        <div className="home-stat">
          <strong>B/W</strong>
          <span>Mono type</span>
        </div>
      </div>
    </motion.section>
  );
}
