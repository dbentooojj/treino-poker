"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type TrainingReport, type TrainingSession, type TrainingType } from "../lib/training";
import { suitColorClass } from "../lib/poker/cards";
import { DatabaseTrainer, TrainingReportView, TrainingSetup } from "./training-experience";

type ActionName = "Fold" | "Check" | "Call" | "Bet" | "Raise" | "All-in";
type StatState = { answered: number; correct: number; errors: number; topics: Record<string, number> };
type CurrentUser = { id:string; name:string; email:string; role:"admin"|"user" };
const LAST_TRAINING_SESSION_KEY = "rangelab:last-training-session";

const modes = ["Pre-flop", "Pós-flop", "Cash Game", "Torneio", "Short Stack", "Heads-Up", "Aleatório"];
const allActions: ActionName[] = ["Fold", "Check", "Call", "Bet", "Raise", "All-in"];

const handStreets = [
  {
    name: "PRÉ-FLOP", pot: "4.7", stack: "39", board: [] as string[],
    prompt: "BTN abre para 2.2 BB. A ação chega até você no Big Blind.",
    history: ["UTG fold", "MP fold", "CO fold", "BTN raise 2.2", "SB fold"],
    enabled: ["Fold", "Call", "Raise", "All-in"] as ActionName[], good: ["Call"] as ActionName[], canonical: "Call",
    verdict: "Defenda o BB com uma mão conectada e jogável.",
    explanation: "98s realiza bem sua equidade contra o range amplo do BTN. Você precisa colocar só 1.2 BB para disputar 5.9 BB e, mesmo fora de posição, a combinação tem conectividade suficiente para defender.",
    metrics: [{k:"Pot odds",v:"20%",d:"Preço baixo para completar"},{k:"Equidade",v:"~39%",d:"vs. range de open do BTN"},{k:"Range",v:"Amplo",d:"BTN abre muitas mãos"},{k:"Posição",v:"OOP",d:"Jogue o pós-flop com cautela"}],
  },
  {
    name: "FLOP", pot: "7.7", stack: "37.8", board: ["Q♠","7♦","6♠"],
    prompt: "Você dá check. BTN aposta 1.8 BB. Qual é a melhor resposta?",
    history: ["Pré: BTN 2.2, Hero call", "Flop: Hero check", "BTN bet 1.8"],
    enabled: ["Fold", "Call", "Raise", "All-in"] as ActionName[], good: ["Raise", "Call"] as ActionName[], canonical: "Raise",
    verdict: "Combo draw forte: continue com agressividade.",
    explanation: "Você tem flush draw + open-ended straight draw. O raise pressiona a parte média do range do BTN e mantém muita equidade quando recebe call. Call também é uma linha sólida; fold abandona equidade demais.",
    metrics: [{k:"Pot odds",v:"19%",d:"Para o call imediato"},{k:"Equidade",v:"Alta",d:"15 outs brutos no flop"},{k:"Blockers",v:"9♠ 8♠",d:"Bloqueia continuações de espadas"},{k:"SPR",v:"4.9",d:"Espaço para check-raise"}],
  },
  {
    name: "TURN", pot: "18.9", stack: "31.3", board: ["Q♠","7♦","6♠","T♥"],
    prompt: "BTN pagou seu check-raise no flop. O T♥ completa sua sequência. Você fala primeiro.",
    history: ["Pré: BTN 2.2, Hero call", "Flop: Hero x/r 6.5", "BTN call 4.7"],
    enabled: ["Check", "Bet", "All-in"] as ActionName[], good: ["Bet"] as ActionName[], canonical: "Bet",
    verdict: "Valor e proteção: continue apostando.",
    explanation: "O turn melhora muito sua mão e seu range de defesa contém mais 98 e 85 suited que o range do BTN. Apostar extrai de Qx, pares + draw e flush draws, além de preparar um river com SPR baixo.",
    metrics: [{k:"Vant. nuts",v:"Hero",d:"BB possui mais 98s/85s"},{k:"SPR",v:"1.7",d:"Stack já conversa com o pote"},{k:"Equidade",v:"Muito alta",d:"Sequência + redraw de flush"},{k:"Range",v:"Polarize",d:"Valor forte + melhores draws"}],
  },
  {
    name: "RIVER", pot: "39.7", stack: "20.9", board: ["Q♠","7♦","6♠","T♥","2♣"],
    prompt: "BTN pagou 10.4 BB no turn. O 2♣ é um blank e o flush draw falhou. Sua ação?",
    history: ["Flop: Hero x/r 6.5, BTN call", "Turn: Hero bet 10.4", "BTN call"],
    enabled: ["Check", "Bet", "All-in"] as ActionName[], good: ["Bet"] as ActionName[], canonical: "Bet",
    verdict: "Extraia valor com sizing controlado.",
    explanation: "O river não altera a hierarquia das mãos. Sua sequência continua forte contra a região de Qx, dois pares e sets que chegam aqui. Um bet menor mantém calls piores; all-in tende a isolar você contra uma faixa mais forte.",
    metrics: [{k:"SPR",v:"0.53",d:"Pote grande, stack curto"},{k:"Sizing",v:"30–45%",d:"Valor contra bluff-catchers"},{k:"Blockers",v:"♠♠",d:"Menos draws de espadas no vilão"},{k:"Vant. nuts",v:"Hero",d:"Linha de x/r concentra straights"}],
  },
];

function Card({ rank, suit }: { rank: string; suit: string }) {
  return <div className={`playing-card ${suitColorClass(suit)}`}><span>{rank}</span><b>{suit}</b></div>;
}

function BoardCard({ value }: { value: string }) {
  const rank = value.slice(0, -1), suit = value.slice(-1);
  return <div className={`board-card ${suitColorClass(suit)}`}><b>{rank}</b><span>{suit}</span></div>;
}

function MiniTable() {
  return <div className="hero-table-wrap" aria-label="Exemplo de uma mesa de treinamento"><div className="hero-table"><div className="table-line"/><div className="mini-seat seat-top"><span>BTN</span><b>42 BB</b></div><div className="mini-seat seat-left"><span>UTG</span><b>38 BB</b></div><div className="mini-seat seat-right"><span>SB</span><b>25 BB</b></div><div className="mini-pot"><span>POTE</span><b>5.9 BB</b></div><div className="mini-action">RAISE <b>2.2 BB</b></div><div className="hero-cards"><Card rank="9" suit="♠"/><Card rank="8" suit="♠"/></div><div className="mini-hero"><span>VOCÊ · BB</span><b>40 BB</b></div></div><div className="floating-tip"><i>✦</i><span><b>Decida primeiro.</b>A análise só aparece depois.</span></div></div>;
}

function Setup({ mode, setMode, onClose, onStart }: { mode:string; setMode:(v:string)=>void; onClose:()=>void; onStart:()=>void }) {
  const [stack,setStack]=useState("40"), [players,setPlayers]=useState("6"), [difficulty,setDifficulty]=useState("Intermediário"), [stage,setStage]=useState("Meio"), [icm,setIcm]=useState(false);
  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><section className="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title"><button className="close-button" aria-label="Fechar" onClick={onClose}>×</button><div className="setup-heading"><span>CONFIGURAÇÃO RÁPIDA</span><h2 id="setup-title">Como você quer treinar?</h2><p>Você pode mudar tudo depois.</p></div>
    <div className="setup-group"><label>Modo</label><div className="choice-grid modes-grid">{modes.map(item=><button key={item} className={mode===item?'selected':''} onClick={()=>setMode(item)}>{item}</button>)}</div></div>
    <div className="setup-row"><div className="setup-group"><label htmlFor="stack">Stack efetivo</label><div className="input-unit"><input id="stack" type="number" min="5" max="250" value={stack} onChange={e=>setStack(e.target.value)}/><span>BB</span></div></div><div className="setup-group"><label>Nº de jogadores</label><div className="choice-grid compact">{['2','6','9'].map(n=><button key={n} className={players===n?'selected':''} onClick={()=>setPlayers(n)}>{n}</button>)}</div></div></div>
    <div className="setup-row"><div className="setup-group"><label>Blinds</label><div className="static-input">0.5 / 1 BB</div></div><div className="setup-group"><label>Dificuldade</label><select value={difficulty} onChange={e=>setDifficulty(e.target.value)}><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select></div></div>
    {mode==='Torneio'&&<div className="tournament-options"><label>Fase do torneio</label><div className="choice-grid stage-grid">{['Início','Meio','Bolha','ITM','Mesa final'].map(s=><button key={s} className={stage===s?'selected':''} onClick={()=>setStage(s)}>{s}</button>)}</div><div className="icm-row"><span><b>ICM</b><small>Considerar impacto dos payjumps</small></span><button className={`toggle ${icm?'on':''}`} aria-label="Ativar ICM" aria-pressed={icm} onClick={()=>setIcm(!icm)}><i/></button></div></div>}
    <button className="start-button" onClick={onStart}>Começar agora <span>→</span></button>
  </section></div>;
}

function PokerTable({ street }: { street:number }) {
  const spot=handStreets[street];
  return <div className="trainer-table-shell"><div className="trainer-table"><div className="trainer-inner-line"/><div className="game-seat game-btn"><span>BTN</span><b>{street===0?'40':'37.8'} BB</b><small>{street===0?'RAISE 2.2':street===1?'BET 1.8':street===2?'CALL 6.5':'CALL 10.4'}</small></div><div className="game-seat game-utg"><span>UTG</span><b>32 BB</b><small>FOLD</small></div><div className="game-seat game-mp"><span>MP</span><b>46 BB</b><small>FOLD</small></div><div className="game-seat game-co"><span>CO</span><b>51 BB</b><small>FOLD</small></div><div className="game-seat game-sb"><span>SB</span><b>25 BB</b><small>FOLD</small></div>
    <div className="center-pot"><span>POTE</span><b>{spot.pot} BB</b></div>{spot.board.length>0&&<div className="board-row">{spot.board.map((c,i)=><BoardCard value={c} key={i}/>)}</div>}
    <div className="trainer-hero-cards"><Card rank="9" suit="♠"/><Card rank="8" suit="♠"/></div><div className="game-seat game-hero"><span>VOCÊ · BB</span><b>{spot.stack} BB</b><small>SUA AÇÃO</small></div></div></div>;
}

function Trainer({ mode, onExit }: { mode:string; onExit:()=>void }) {
  const [street,setStreet]=useState(0), [answer,setAnswer]=useState<ActionName|null>(null), [sizing,setSizing]=useState<ActionName|null>(null), [unit,setUnit]=useState<'BB'|'% pote'>('BB'), [size,setSize]=useState(6.5), [spotNo,setSpotNo]=useState(1);
  const [stats,setStats]=useState<StatState>({answered:0,correct:0,errors:0,topics:{}});
  const spot=handStreets[street];
  const good=answer ? spot.good.includes(answer) : false;
  const accuracy=stats.answered?Math.round(stats.correct/stats.answered*100):0;
  const topErrors=useMemo(()=>Object.entries(stats.topics).sort((a,b)=>b[1]-a[1]).slice(0,3),[stats.topics]);

  function decide(action:ActionName){ if(answer)return; if(action==='Bet'||action==='Raise'){setSizing(action);return;} finish(action); }
  function finish(action:ActionName){
    const ok=spot.good.includes(action); setAnswer(action); setSizing(null);
    setStats(prev=>({answered:prev.answered+1,correct:prev.correct+(ok?1:0),errors:prev.errors+(ok?0:1),topics:ok?prev.topics:{...prev.topics,[spot.metrics[0].k]:(prev.topics[spot.metrics[0].k]||0)+1}}));
  }
  function next(){ setAnswer(null); setSizing(null); setUnit('BB'); if(street<3){setStreet(street+1);setSize(street===0?6.5:10.4);}else{setStreet(0);setSpotNo(spotNo+1);setSize(6.5);} }

  return <main className="training-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>SPOT #{String(spotNo).padStart(2,'0')}</span><b>{mode} · 6-max · 40 BB · 0.5/1</b></div><button className="exit-button" onClick={onExit}>← Sair do treino</button></header>
    <div className="street-progress">{handStreets.map((s,i)=><div key={s.name} className={`${i===street?'active':''} ${i<street?'done':''}`}><i>{i<street?'✓':i+1}</i><span>{s.name}</span></div>)}</div>
    <section className="trainer-layout"><div className="practice-column"><div className="table-meta"><span><i/> MÃO EM ANDAMENTO</span><div>{spot.history.map((h,i)=><small key={i}>{h}</small>)}</div></div><PokerTable street={street}/>
      <div className="decision-panel"><div className="decision-copy"><span>SUA DECISÃO</span><h1>{spot.prompt}</h1><p>Escolha uma ação. A análise só aparece depois da sua resposta.</p></div>
        {!answer&&<div className="action-grid">{allActions.map(action=><button key={action} disabled={!spot.enabled.includes(action)} onClick={()=>decide(action)} className={`action-${action.toLowerCase().replace('-','')}`}><span>{action==='Fold'?'×':action==='Check'?'✓':action==='Call'?'●':action==='Bet'?'◆':action==='Raise'?'▲':'⚡'}</span>{action}<small>{spot.enabled.includes(action)?(action==='Bet'||action==='Raise'?'escolher sizing':''):'indisponível'}</small></button>)}</div>}
        {!answer&&sizing&&<div className="sizing-box"><div className="sizing-head"><span><b>{sizing}</b> · Escolha o tamanho</span><button onClick={()=>setSizing(null)}>×</button></div><div className="sizing-controls"><div className="unit-tabs"><button className={unit==='BB'?'active':''} onClick={()=>setUnit('BB')}>BB</button><button className={unit==='% pote'?'active':''} onClick={()=>setUnit('% pote')}>% do pote</button></div><div className="preset-row">{(unit==='BB'?[4.5,6.5,8,12]:[33,50,66,100]).map(n=><button key={n} className={size===n?'active':''} onClick={()=>setSize(n)}>{n}{unit==='BB'?' BB':'%'}</button>)}</div><div className="size-value"><span>Tamanho escolhido</span><b>{size}{unit==='BB'?' BB':'%'}</b></div><input aria-label="Tamanho da aposta" type="range" min={unit==='BB'?2:20} max={unit==='BB'?25:150} step={unit==='BB'?.5:5} value={size} onChange={e=>setSize(Number(e.target.value))}/><button className="confirm-size" onClick={()=>finish(sizing)}>Confirmar {sizing} →</button></div></div>}
        {answer&&<div className={`feedback ${good?'feedback-good':'feedback-bad'}`}><div className="verdict-icon">{good?'✓':'!'}</div><div className="feedback-main"><span>{good?'BOA DECISÃO':'REVEJA ESTA DECISÃO'}</span><h2>{spot.verdict}</h2><p>{spot.explanation}</p><div className="metric-grid">{spot.metrics.map(m=><div key={m.k}><span>{m.k}</span><b>{m.v}</b><small>{m.d}</small></div>)}</div><div className="feedback-bottom"><small>{!good&&<>Linha recomendada: <b>{spot.canonical}</b> · </>}A próxima street segue a linha recomendada para manter a mão consistente.</small><button onClick={next}>{street===3?'Próximo spot':'Continuar para '+handStreets[Math.min(street+1,3)].name} →</button></div></div></div>}
      </div>
    </div>
    <aside className="stats-rail"><div className="session-card"><div className="rail-title"><span>SESSÃO ATUAL</span><i>● ao vivo</i></div><div className="accuracy-ring" style={{'--accuracy':`${accuracy*3.6}deg`} as React.CSSProperties}><div><b>{accuracy}%</b><span>acerto</span></div></div><div className="stat-row"><div><span>Spots</span><b>{stats.answered}</b></div><div><span>Acertos</span><b className="green-text">{stats.correct}</b></div><div><span>Erros</span><b className="red-text">{stats.errors}</b></div></div></div>
      <div className="leak-card"><div className="rail-title"><span>ONDE VOCÊ MAIS ERRA</span></div>{topErrors.length?topErrors.map(([name,count])=><div className="leak-row" key={name}><span>{name}</span><b>{count} erro{count>1?'s':''}</b></div>):<p>Responda alguns spots para o RangeLab mapear seus pontos de estudo.</p>}</div>
      <div className="concept-card"><span>CONCEITOS DESTE SPOT</span><div>{spot.metrics.map(m=><i key={m.k}>{m.k}</i>)}</div></div>
    </aside></section>
  </main>;
}

// Protótipo visual anterior mantido isolado durante a migração; o fluxo público usa apenas DatabaseTrainer.
void Setup;
void Trainer;

export default function Home() {
  const router = useRouter();
  const [setupOpen,setSetupOpen]=useState(false), [preferredType,setPreferredType]=useState<TrainingType|undefined>(), [trainingSession,setTrainingSession]=useState<TrainingSession|null>(null), [trainingReport,setTrainingReport]=useState<TrainingReport|null>(null), [currentUser,setCurrentUser]=useState<CurrentUser|null>(null), [authReady,setAuthReady]=useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    async function restoreUserAndTraining() {
      try {
        const authResponse = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        const authData = authResponse.ok ? await authResponse.json() as { user: CurrentUser | null } : { user: null };
        if (controller.signal.aborted) return;
        setCurrentUser(authData.user ?? null);
        if (authData.user) {
          let restored = false;
          const savedSessionId = window.sessionStorage.getItem(LAST_TRAINING_SESSION_KEY);
          if (savedSessionId && /^[0-9a-f-]{36}$/i.test(savedSessionId)) {
            const savedResponse = await fetch(`/api/training/session?id=${encodeURIComponent(savedSessionId)}`, { cache: "no-store", signal: controller.signal });
            if (savedResponse.ok) {
              const savedData = await savedResponse.json() as { session?: TrainingSession; report?: TrainingReport };
              if (!controller.signal.aborted && savedData.session) setTrainingSession(savedData.session);
              if (!controller.signal.aborted && savedData.report) setTrainingReport(savedData.report);
              restored = Boolean(savedData.session || savedData.report);
            }
            if (!restored) window.sessionStorage.removeItem(LAST_TRAINING_SESSION_KEY);
          }
          if (!restored) {
            const trainingResponse = await fetch("/api/training/session?active=1", { cache: "no-store", signal: controller.signal });
            const trainingData = trainingResponse.ok ? await trainingResponse.json() as { session: TrainingSession | null } : { session: null };
            if (!controller.signal.aborted) setTrainingSession(trainingData.session);
            if (trainingData.session) window.sessionStorage.setItem(LAST_TRAINING_SESSION_KEY, trainingData.session.id);
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCurrentUser(null);
          setTrainingSession(null);
          setTrainingReport(null);
        }
      } finally {
        if (!controller.signal.aborted) setAuthReady(true);
      }
    }
    void restoreUserAndTraining();
    return()=>controller.abort();
  },[]);
  const isAdmin=currentUser?.role==="admin";
  function rememberTraining(session:TrainingSession){window.sessionStorage.setItem(LAST_TRAINING_SESSION_KEY,session.id);setTrainingReport(null);setTrainingSession(session);}
  function leaveTraining(){window.sessionStorage.removeItem(LAST_TRAINING_SESSION_KEY);setTrainingSession(null);setTrainingReport(null);}
  function openTrainingSetup(){if(!authReady)return;if(!currentUser){router.push("/login");return;}setPreferredType(undefined);setSetupOpen(true);}
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});leaveTraining();setCurrentUser(null);router.refresh();}
  if(trainingReport&&currentUser)return <TrainingReportView report={trainingReport} onExit={leaveTraining} onStarted={rememberTraining}/>;
  if(trainingSession&&currentUser)return <DatabaseTrainer key={trainingSession.id} session={trainingSession} user={currentUser} onExit={leaveTraining} onStarted={rememberTraining}/>;
  return <main className="site-shell"><header className="topbar"><div className="topbar-primary"><a className="brand" href="#top"><span className="brand-mark">R</span><span>Range<span>Lab</span></span></a><nav className="nav-links" aria-label="Navegação principal">{currentUser&&<Link href="/progresso">Progresso</Link>}{currentUser&&<Link href="/ferramentas">Ferramentas</Link>}{isAdmin&&<Link href="/admin/studies">Estudos HRC</Link>}</nav></div><div className="top-actions">{currentUser?<><Link className="user-chip user-chip-link" href="/conta" aria-label="Abrir minha conta"><i>{currentUser.name.charAt(0).toUpperCase()}</i><b>{currentUser.name}</b>{isAdmin&&<small>ADM</small>}<span aria-hidden="true">›</span></Link><button className="logout-button" onClick={logout}>Sair</button></>:<Link className="login-button" href="/login">Entrar</Link>}</div></header>
    <section className="hero" id="top"><div className="hero-copy"><div className="eyebrow"><span className="live-dot"/> EVOLUA SUAS DECISÕES · TEXAS HOLD’EM</div><h1>Pare de adivinhar.<br/><em>Jogue com vantagem.</em></h1><p>Transforme cada spot em uma decisão mais confiante. Treine mãos completas, receba feedback objetivo e leve uma estratégia mais sólida para suas mesas.</p><div className="hero-actions"><button className="primary-button" onClick={openTrainingSetup} disabled={!authReady}><span>▶</span> {currentUser?"Começar treinamento":"Começar agora"}</button></div><div className="concept-row">{['Range','Pot odds','Equidade','Blockers','SPR','ICM'].map(i=><span key={i}>{i}</span>)}</div></div><MiniTable/></section>
    <section className="promise-grid" id="treinar"><article><span>01</span><h2>Spots reais do estudo.</h2><p>Enfrente decisões que fazem parte da rotina de quem joga torneios.</p></article><article><span>02</span><h2>Frequências e EVs.</h2><p>Veja o impacto de cada escolha e descubra onde está o seu maior ganho.</p></article><article id="progresso"><span>03</span><h2>Configuração sem atalhos.</h2><p>Personalize o treino para o seu momento de jogo e evolua com consistência.</p></article></section>
    {setupOpen&&<TrainingSetup preferredType={preferredType} onClose={()=>setSetupOpen(false)} onStarted={(session)=>{setSetupOpen(false);rememberTraining(session);}}/>}
  </main>;
}
