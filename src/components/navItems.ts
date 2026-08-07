import {
  Eye,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Radar,
  Thermometer,
} from "lucide-react";
import type { ProductAcronym } from "../lib/productNames";

export type NavId =
  | "overview"
  | "scanners"
  | "analysis"
  | "temperature"
  | "swatch"
  | "future-features";

export type NavItem = {
  id: NavId;
  path: string;
  icon: typeof LayoutDashboard;
} & ({ label: string; acronym?: never } | { acronym: ProductAcronym; label?: never });

export const NAV_ITEMS: NavItem[] = [
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
