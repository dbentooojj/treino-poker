import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

function buttonClass(variant: ButtonVariant, size: ButtonSize, iconOnly: boolean, fullWidth: boolean, className?: string) {
  return ["rl-button", `rl-button--${variant}`, size !== "md" ? `rl-button--${size}` : "", iconOnly ? "rl-button--icon" : "", fullWidth ? "rl-button--full" : "", className ?? ""].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", iconOnly = false, fullWidth = false, loading = false, children, className, disabled, ...props }, ref) {
  return <button ref={ref} className={buttonClass(variant, size, iconOnly, fullWidth, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="rl-button__spinner" aria-hidden="true"/>}
    {children}
  </button>;
});

export function ButtonLink({ href, variant = "primary", size = "md", iconOnly = false, fullWidth = false, children, className, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return <Link href={href} className={buttonClass(variant, size, iconOnly, fullWidth, className)} {...props}>{children}</Link>;
}
