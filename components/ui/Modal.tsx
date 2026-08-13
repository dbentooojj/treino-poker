"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Icon } from "./Icon";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Modal({ titleId, descriptionId, onClose, children, className, closeLabel = "Fechar" }: { titleId: string; descriptionId?: string; onClose: () => void; children: ReactNode; className?: string; closeLabel?: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(<div className="rl-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className={["rl-modal", className ?? ""].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <Button ref={closeRef} type="button" className="rl-modal__close" variant="ghost" iconOnly aria-label={closeLabel} onClick={onClose}><Icon name="close"/></Button>
      {children}
    </div>
  </div>, document.body);
}
