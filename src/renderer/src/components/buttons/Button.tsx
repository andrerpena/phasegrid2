import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "destructive";
  size?: "sm" | "md";
  children: ReactNode;
}

export const Button = ({
  variant = "default",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) => (
  <button
    type="button"
    className={[styles.button, styles[variant], styles[size], className]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </button>
);
