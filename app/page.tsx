"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "../components/ui/AppHeader";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";

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

  function openTraining() {
    if (authReady) router.push(currentUser ? "/treinar" : "/login");
  }

  return <main className="site-shell">
    <AppHeader user={currentUser} active="home" onLoggedOut={() => setCurrentUser(null)}/>

    <section className="hero" id="top">
      <div className="hero-copy">
        <div className="eyebrow"><span className="live-dot"/> EVOLUA SUAS DECISÕES · TEXAS HOLD’EM</div>
        <h1>Pare de adivinhar.<br/><em>Jogue com vantagem.</em></h1>
        <p>Treine decisões pré-flop com estudos publicados, receba feedback objetivo e leve uma estratégia mais sólida para suas mesas.</p>
        <div className="hero-actions"><Button type="button" size="lg" loading={!authReady} onClick={openTraining}><Icon name="play"/>{authReady ? currentUser ? "Começar treinamento" : "Começar agora" : "Carregando"}</Button></div>
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
