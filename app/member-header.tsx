"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthUser } from "../db/auth";

export default function MemberHeader({ user, active }: { user: AuthUser | null; active?: "account" | "progress" | "tools" | "training" }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return <header className="topbar member-topbar">
    <div className="topbar-primary">
      <Link className="brand" href="/" aria-label="RangeLab, ir para o início"><span className="brand-mark">R</span><span>Range<span>Lab</span></span></Link>
      <nav className="nav-links" aria-label="Navegação principal">
        <Link href="/">Início</Link>
        {user && <Link className={active === "progress" ? "active" : ""} href="/progresso">Progresso</Link>}
        {user && <Link className={active === "tools" ? "active" : ""} href="/ferramentas">Ferramentas</Link>}
        {user && <Link className={active === "training" ? "active" : ""} href="/treinar">Treinar</Link>}
        {user?.role === "admin" && <Link href="/admin/studies">Estudos HRC</Link>}
      </nav>
    </div>
    <div className="top-actions">
      {user ? <>
        <Link className={`user-chip user-chip-link ${active === "account" ? "active" : ""}`} href="/conta" aria-label="Abrir minha conta">
          <i>{user.name.charAt(0).toUpperCase()}</i><b>{user.name}</b>{user.role === "admin" && <small>ADM</small>}<span aria-hidden="true">›</span>
        </Link>
        <button className="logout-button" type="button" onClick={logout}>Sair</button>
      </> : <Link className="login-button" href="/login">Entrar</Link>}
    </div>
  </header>;
}
