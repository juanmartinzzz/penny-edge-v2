import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

type Variant = "primary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  iconOnly?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  iconOnly = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "btn",
    variant === "primary" ? "btn-primary" : "btn-ghost",
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
