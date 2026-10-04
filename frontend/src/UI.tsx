import { Check, ArrowRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "text";
  children: ReactNode;
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {children}
    </button>
  );
}
export function Steps({ active }: { active: number }) {
  return (
    <ol className="steps" aria-label="Analysis steps">
      {["Upload", "Review", "Forecast"].map((s, i) => (
        <li
          key={s}
          aria-current={active === i ? "step" : undefined}
          className={i <= active ? "reached" : ""}
        >
          <span>{i < active ? <Check size={14} /> : i + 1}</span>
          {s}
          {i < 2 && <i />}
        </li>
      ))}
    </ol>
  );
}
export function Notice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "success";
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}
export function NextIcon() {
  return <ArrowRight size={17} strokeWidth={1.7} />;
}
