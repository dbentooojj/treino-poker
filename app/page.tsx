"use client";

import { useState } from "react";

const modes = [
  "Pre-flop",
  "Pós-flop",
  "Cash Game",
  "Torneio",
  "Short Stack",
  "Heads-Up",
  "Aleatório",
];

function Card({ rank, suit }: { rank: string; suit: string }) {
  const red = suit === "♥" || suit === "♦";
  return (
    <div className={`playing-card ${red ? "red-suit" : "black-suit"}`}>
      <span>{rank}</span>
      <b>{suit}</b>
    </div>
  );
}

function MiniTable() {
  return (
    <div className="hero-table-wrap" aria-label="Exemplo de uma mesa de treinamento">
      <div className="hero-table">
        <div className="table-line" />
        <div className="mini-seat seat-top"><span>BTN</span><b>42 BB</b></div>
        <div className="mini-seat seat-left"><span>UTG</span><b>38 BB</b></div>
        <div className="mini-seat seat-right"><span>SB</span><b>25 BB</b></div>
        <div className="mini-pot"><span>POTE</span><b>5.9 BB</b></div>
        <div className="mini-action">RAISE <b>2.2 BB</b></div>
        <div className="hero-cards"><Card rank="9" suit="♠" /><Card rank="8" suit="♠" /></div>
        <div className="mini-hero"><span>VOCÊ · BB</span><b>40 BB</b></div>
      </div>
      <div className="floating-tip"><i>✦</i><span><b>Decida primeiro.</b> A análise só aparece depois.</span></div>
    </div>
  );
}

export default function Home() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [mode, setMode] = useState("Torneio");
  const [stack, setStack] = useState("40");
  const [players, setPlayers] = useState("6");
  const [difficulty, setDifficulty] = useState("Intermediário");

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RangeLab - início">
          <span className="brand-mark">R</span>
          <span>Range<span>Lab</span></span>
        </a>
        <nav className="nav-links" aria-label="Navegação principal">
          <a href="#treinar">Treinar</a>
          <a href="#modos">Modos</a>
          <a href="#progresso">Progresso</a>
        </nav>
        <button className="ghost-button" onClick={() => setSetupOpen(true)}>Configurar</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> TREINO DE DECISÃO · TEXAS HOLD’EM</div>
          <h1>Leia o spot.<br/><em>Tome a decisão.</em></h1>
          <p>Treine ranges, pot odds e linhas pós-flop em mãos completas — do pré-flop ao river. Sem ver a resposta antes da hora.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => setSetupOpen(true)}>
              <span>▶</span> Começar treinamento
            </button>
            <span className="hero-note">Configuração em menos de 20 segundos</span>
          </div>
          <div className="concept-row" aria-label="Conceitos treinados">
            {['Range', 'Pot odds', 'Equidade', 'Blockers', 'SPR', 'ICM'].map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <MiniTable />
      </section>

      <section className="mode-strip" id="modos">
        <p>ESCOLHA SEU JOGO</p>
        <div className="mode-list">
          {modes.map((item) => (
            <button key={item} onClick={() => { setMode(item); setSetupOpen(true); }}>
              <span>{item === 'Torneio' ? '♛' : item === 'Heads-Up' ? '⚡' : item === 'Aleatório' ? '↻' : '♠'}</span>{item}
            </button>
          ))}
        </div>
      </section>

      <section className="promise-grid" id="treinar">
        <article><span>01</span><h2>Uma mão. Quatro streets.</h2><p>Cartas, stacks e ações permanecem consistentes do pré-flop ao river.</p></article>
        <article><span>02</span><h2>Feedback que ensina.</h2><p>Entenda o porquê da decisão com os conceitos que realmente importam no spot.</p></article>
        <article id="progresso"><span>03</span><h2>Erros viram estudo.</h2><p>Acompanhe acertos e descubra quais fundamentos estão custando mais decisões.</p></article>
      </section>

      {setupOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSetupOpen(false); }}>
          <section className="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <button className="close-button" aria-label="Fechar" onClick={() => setSetupOpen(false)}>×</button>
            <div className="setup-heading"><span>CONFIGURAÇÃO RÁPIDA</span><h2 id="setup-title">Como você quer treinar?</h2><p>Você pode mudar tudo depois.</p></div>

            <div className="setup-group">
              <label>Modo</label>
              <div className="choice-grid modes-grid">
                {modes.map((item) => <button key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item}</button>)}
              </div>
            </div>

            <div className="setup-row">
              <div className="setup-group"><label htmlFor="stack">Stack efetivo</label><div className="input-unit"><input id="stack" type="number" min="5" max="250" value={stack} onChange={(e) => setStack(e.target.value)} /><span>BB</span></div></div>
              <div className="setup-group"><label>Nº de jogadores</label><div className="choice-grid compact">{['2','6','9'].map(n => <button key={n} className={players === n ? 'selected' : ''} onClick={() => setPlayers(n)}>{n}</button>)}</div></div>
            </div>

            <div className="setup-row">
              <div className="setup-group"><label>Blinds</label><div className="static-input">0.5 / 1 BB</div></div>
              <div className="setup-group"><label>Dificuldade</label><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select></div>
            </div>

            {mode === 'Torneio' && <div className="tournament-options"><label>Fase do torneio</label><div className="choice-grid stage-grid"><button>Início</button><button className="selected">Meio</button><button>Bolha</button><button>ITM</button><button>Mesa final</button></div><div className="icm-row"><span><b>ICM</b><small>Considerar impacto dos payjumps</small></span><button className="toggle" aria-label="Ativar ICM"><i /></button></div></div>}

            <button className="start-button" onClick={() => alert('O treino interativo entra na próxima etapa desta experiência.')}>Começar agora <span>→</span></button>
          </section>
        </div>
      )}
    </main>
  );
}
