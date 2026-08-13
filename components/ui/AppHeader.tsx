"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuthUser } from "../../db/auth";
import { Button, ButtonLink } from "./Button";
import { Icon, type IconName } from "./Icon";

export type AppHeaderActive = "home" | "progress" | "tools" | "training" | "account" | "admin";

const mainLinks: Array<{ href: string; label: string; active: AppHeaderActive; icon: IconName }> = [
  { href: "/", label: "Início", active: "home", icon: "home" },
  { href: "/treinar", label: "Treinar", active: "training", icon: "training" },
  { href: "/progresso", label: "Progresso", active: "progress", icon: "chart" },
  { href: "/ferramentas", label: "Ferramentas", active: "tools", icon: "tools" },
];

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return <Link className={["rl-brand", className ?? ""].filter(Boolean).join(" ")} href={href} aria-label="RangeLab, ir para o início"><span className="rl-brand__text">Range<span>Lab</span></span></Link>;
}

export default function AppHeader({ user, active = "home", onLoggedOut }: { user: AuthUser | null; active?: AppHeaderActive; onLoggedOut?: () => void }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMenuOpen(false);
    onLoggedOut?.();
    router.push("/");
    router.refresh();
  }

  const links = user ? mainLinks : mainLinks.filter((link) => link.active === "home" || link.active === "tools");
  return <header className="rl-header">
    <div className="rl-header__inner">
      <div className="rl-header__primary">
        <Button type="button" className="rl-header__menu" variant="ghost" iconOnly aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="app-navigation" onClick={() => setMenuOpen((open) => !open)}><Icon name={menuOpen ? "close" : "menu"}/></Button>
        <Brand/>
        <nav id="app-navigation" className={["rl-header__nav", menuOpen ? "rl-header__nav--open" : ""].filter(Boolean).join(" ")} aria-label="Navegação principal">
          {links.map((link) => <Link key={link.href} href={link.href} aria-current={active === link.active ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon name={link.icon}/>{link.label}</Link>)}
          {user?.role === "admin" && <Link href="/admin/studies" aria-current={active === "admin" ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon name="admin"/>Admin</Link>}
          {user && <button type="button" className="rl-header__mobile-only" onClick={logout}><Icon name="logout"/>Sair</button>}
        </nav>
      </div>
      <div className="rl-header__actions">
        {user ? <>
          <Link className="rl-header__account" href="/conta" aria-current={active === "account" ? "page" : undefined} aria-label="Abrir minha conta"><span className="rl-header__avatar">{user.name.charAt(0).toUpperCase()}</span><span className="rl-header__account-name">{user.name}</span>{user.role === "admin" && <small className="rl-header__role">ADM</small>}</Link>
          <Button type="button" className="rl-header__logout" variant="ghost" size="sm" onClick={logout}><Icon name="logout"/>Sair</Button>
        </> : <ButtonLink href="/login" variant="secondary" size="sm">Entrar</ButtonLink>}
      </div>
    </div>
  </header>;
}
