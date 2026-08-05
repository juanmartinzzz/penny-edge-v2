import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

type Variant = "primary" | "ghost" | "plain";
type Tone = "neutral" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Color emphasis — use with ghost/plain (e.g. destructive icon actions). */
  tone?: Tone;
  iconOnly?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  tone = "neutral",
  iconOnly = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "plain"
        ? "btn-plain"
        : "btn-ghost";

  const classes = [
    "btn",
    variantClass,
    tone === "danger" ? "btn-tone-danger" : "",
    iconOnly ? "btn-icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
