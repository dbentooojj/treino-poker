import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function PageContainer({ width = "default", className, children, ...props }: HTMLAttributes<HTMLElement> & { width?: "compact" | "default" | "wide" }) {
  return <section className={["rl-page", width !== "default" ? `rl-page--${width}` : "", className ?? ""].filter(Boolean).join(" ")} {...props}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, action, className }: { eyebrow?: string; title: string; description?: string; action?: ReactNode; className?: string }) {
  return <header className={["rl-page-header", action ? "rl-page-header--row" : "", className ?? ""].filter(Boolean).join(" ")}>
    <div>
      {eyebrow && <span className="rl-page-header__eyebrow">{eyebrow}</span>}
      <h1 className="rl-page-header__title">{title}</h1>
      {description && <p className="rl-page-header__description">{description}</p>}
    </div>
    {action && <div className="rl-page-header__action">{action}</div>}
  </header>;
}

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={["rl-panel", className ?? ""].filter(Boolean).join(" ")} {...props}>{children}</section>;
}

export function StatusMessage({ tone = "info", children, className }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode; className?: string }) {
  const icon: IconName = tone === "error" || tone === "warning" ? "alert" : tone === "success" ? "check" : "info";
  return <div className={["rl-status", tone !== "info" ? `rl-status--${tone}` : "", className ?? ""].filter(Boolean).join(" ")} role={tone === "error" ? "alert" : "status"}>
    <Icon name={icon}/><div>{children}</div>
  </div>;
}

export function EmptyState({ icon = "info", title, description, actions, headingLevel = 2, className }: { icon?: IconName; title: string; description: string; actions?: ReactNode; headingLevel?: 2 | 3; className?: string }) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return <div className={["rl-empty", className ?? ""].filter(Boolean).join(" ")}>
    <div className="rl-empty__icon"><Icon name={icon}/></div>
    <Heading>{title}</Heading>
    <p>{description}</p>
    {actions && <div className="rl-empty__actions">{actions}</div>}
  </div>;
}

type SegmentOption<T extends string | number> = { value: T; label: string; disabled?: boolean };

export function SegmentedControl<T extends string | number>({ label, value, options, onChange, className }: { label: string; value: T; options: readonly SegmentOption<T>[]; onChange: (value: T) => void; className?: string }) {
  return <div className={["rl-segmented", className ?? ""].filter(Boolean).join(" ")} role="group" aria-label={label}>
    {options.map((option) => <button type="button" key={String(option.value)} disabled={option.disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function SegmentedTabs<T extends string>({ label, value, options, onChange, panelId, className }: { label: string; value: T; options: readonly SegmentOption<T>[]; onChange: (value: T) => void; panelId: string; className?: string }) {
  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, option: SegmentOption<T>) {
    if (!event.currentTarget.parentElement || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = options.filter((item) => !item.disabled);
    const current = enabled.findIndex((item) => item.value === option.value);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : event.key === "ArrowRight" ? (current + 1) % enabled.length : (current - 1 + enabled.length) % enabled.length;
    onChange(enabled[next].value);
    const buttons = event.currentTarget.parentElement.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    buttons[next]?.focus();
  }
  return <div className={["rl-segmented", className ?? ""].filter(Boolean).join(" ")} role="tablist" aria-label={label}>
    {options.map((option) => <button id={`tab-${option.value}`} type="button" role="tab" key={option.value} disabled={option.disabled} aria-selected={value === option.value} aria-controls={panelId} tabIndex={value === option.value ? 0 : -1} onKeyDown={(event) => moveFocus(event, option)} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
