"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type CurrentUser = { id: string; name: string; email: string; role: "admin" | "user" };

function TrainingPreview() {
  return <div className="hero-table-wrap" aria-label="Área de treinamento do RangeLab">
    <div className="hero-table hero-table-empty">
      <div className="table-line"/>
      <div className="hero-training-message">
        <span>RANGELAB</span>
        <b>Treino com estudos publicados</b>
        <small>Decisões pré-flop baseadas nos dados importados do HRC.</small>
      </div>
    </div>
    <div className="floating-tip"><i>✦</i><span><b>Decida primeiro.</b>A análise aparece depois da resposta.</span></div>
  </div>;
}

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function restoreUser() {
      try {
        const authResponse = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        const authData = authResponse.ok ? await authResponse.json() as { user: CurrentUser | null } : { user: null };
        if (!controller.signal.aborted) setCurrentUser(authData.user ?? null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setCurrentUser(null);
      } finally {
        if (!controller.signal.aborted) setAuthReady(true);
      }
    }
    void restoreUser();
    return () => controller.abort();
  }, []);

  const isAdmin = currentUser?.role === "admin";
  function openTraining() {
    if (authReady) router.push(currentUser ? "/treinar" : "/login");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    router.refresh();
  }

  return <main className="site-shell">
    <header className="topbar">
      <div className="topbar-primary">
        <a className="brand" href="#top"><span className="brand-mark">R</span><span>Range<span>Lab</span></span></a>
        <nav className="nav-links" aria-label="Navegação principal">
          <a className="active" href="#top">Início</a>
          {currentUser && <Link href="/progresso">Progresso</Link>}
          {currentUser && <Link href="/ferramentas">Ferramentas</Link>}
          {currentUser && <Link href="/treinar">Treinar</Link>}
          {isAdmin && <Link href="/admin/studies">Estudos HRC</Link>}
        </nav>
      </div>
      <div className="top-actions">{currentUser ? <>
        <Link className="user-chip user-chip-link" href="/conta" aria-label="Abrir minha conta"><i>{currentUser.name.charAt(0).toUpperCase()}</i><b>{currentUser.name}</b>{isAdmin && <small>ADM</small>}<span aria-hidden="true">›</span></Link>
        <button className="logout-button" onClick={logout}>Sair</button>
      </> : <Link className="login-button" href="/login">Entrar</Link>}</div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy">
        <div className="eyebrow"><span className="live-dot"/> EVOLUA SUAS DECISÕES · TEXAS HOLD’EM</div>
        <h1>Pare de adivinhar.<br/><em>Jogue com vantagem.</em></h1>
        <p>Treine decisões pré-flop com estudos publicados, receba feedback objetivo e leve uma estratégia mais sólida para suas mesas.</p>
        <div className="hero-actions"><button className="primary-button" onClick={openTraining} disabled={!authReady}><span>▶</span> {currentUser ? "Começar treinamento" : "Começar agora"}</button></div>
        <div className="concept-row">{["Range", "EV", "Frequências", "Stacks", "Posições", "ICM"].map((item) => <span key={item}>{item}</span>)}</div>
      </div>
      <TrainingPreview/>
    </section>

    <section className="promise-grid" id="treinar">
      <article><span>01</span><h2>Spots reais do estudo.</h2><p>Treine somente decisões presentes nos estudos publicados.</p></article>
      <article><span>02</span><h2>Frequências e EVs.</h2><p>Compare cada escolha com os dados importados e identifique seus erros.</p></article>
      <article id="progresso"><span>03</span><h2>Progresso verificável.</h2><p>Acompanhe sessões e respostas registradas na sua conta.</p></article>
    </section>
  </main>;
}
