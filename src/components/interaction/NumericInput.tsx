import type { InputHTMLAttributes } from "react";
import "./NumericInput.css";

type NumericInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export function NumericInput({ label, className = "", id, ...props }: NumericInputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <label className={`numeric-input ${className}`.trim()} htmlFor={inputId}>
      <span className="numeric-input-label">{label}</span>
      <input id={inputId} type="number" inputMode="decimal" {...props} />
    </label>
  );
}
