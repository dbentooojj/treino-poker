"use client";

import { FormEvent, useState } from "react";

type AuthMode = "login" | "recovery";

export default function AuthExperience({ mode }: { mode: AuthMode }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loginNotice, setLoginNotice] = useState(false);

  const isRecovery = mode === "recovery";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecovery) setSubmitted(true);
    else setLoginNotice(true);
  }

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <a className="brand" href="/" aria-label="RangeLab, voltar para o início">
          <span className="brand-mark">R</span>
          <span>Range<span>Lab</span></span>
        </a>
        <a className="auth-back" href="/">← Voltar para o início</a>
      </header>

      <section className="auth-layout">
        <div className="auth-story" aria-hidden="true">
          <div className="auth-eyebrow"><span /> TREINE. REVISE. EVOLUA.</div>
          <h1>Decisões melhores<br /><em>começam aqui.</em></h1>
          <p>Entre para continuar seus treinos, acompanhar sua evolução e transformar cada erro em estudo.</p>

          <div className="auth-visual">
            <div className="auth-table-line" />
            <div className="auth-pot"><span>SEU PROGRESSO</span><b>78%</b><small>precisão nos últimos 20 spots</small></div>
            <div className="auth-card auth-card-one"><strong>A</strong><span>♠</span></div>
            <div className="auth-card auth-card-two"><strong>K</strong><span>♠</span></div>
            <div className="auth-hand-label"><span>ÚLTIMA SESSÃO</span><b>+12 decisões corretas</b></div>
          </div>

          <div className="auth-benefits">
            <span><i>✓</i> Histórico de treinos</span>
            <span><i>✓</i> Leaks mapeados</span>
            <span><i>✓</i> Evolução por conceito</span>
          </div>
        </div>

        <div className="auth-panel-wrap">
          <section className="auth-panel" aria-labelledby="auth-title">
            {submitted ? (
              <div className="recovery-success" role="status">
                <div className="success-icon">✓</div>
                <span>LINK SOLICITADO</span>
                <h2 id="auth-title">Confira seu e-mail</h2>
                <p>Se existir uma conta associada a <b>{email}</b>, você receberá as instruções para criar uma nova senha.</p>
                <a className="auth-submit" href="/login">Voltar para o login</a>
                <button type="button" className="auth-text-button" onClick={() => setSubmitted(false)}>Usar outro e-mail</button>
              </div>
            ) : (
              <>
                <div className="auth-heading">
                  <span>{isRecovery ? "RECUPERAR ACESSO" : "BEM-VINDO DE VOLTA"}</span>
                  <h2 id="auth-title">{isRecovery ? "Esqueceu sua senha?" : "Entre na sua conta"}</h2>
                  <p>{isRecovery ? "Informe o e-mail da sua conta e enviaremos as instruções para redefinir sua senha." : "Continue de onde parou e mantenha seu progresso em jogo."}</p>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                  <label htmlFor="email">E-mail</label>
                  <div className="auth-field">
                    <span aria-hidden="true">@</span>
                    <input id="email" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={(event) => { setEmail(event.target.value); setLoginNotice(false); }} required autoFocus />
                  </div>

                  {!isRecovery && (
                    <>
                      <div className="auth-label-row">
                        <label htmlFor="password">Senha</label>
                        <a href="/recuperar-senha">Esqueci minha senha</a>
                      </div>
                      <div className="auth-field">
                        <span aria-hidden="true">●</span>
                        <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Sua senha" minLength={6} required onChange={() => setLoginNotice(false)} />
                        <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? "Ocultar" : "Mostrar"}</button>
                      </div>
                      <label className="remember-row"><input type="checkbox" name="remember" /> <span>Lembrar de mim neste dispositivo</span></label>
                    </>
                  )}

                  {loginNotice && <p className="auth-notice" role="status">A interface está pronta. A validação das credenciais será ativada quando o provedor de autenticação for conectado.</p>}

                  <button className="auth-submit" type="submit">{isRecovery ? "Enviar link de recuperação" : "Entrar na conta"}<span>→</span></button>
                </form>

                <div className="auth-separator"><span>ACESSO SEGURO</span></div>
                <p className="auth-footer-copy">{isRecovery ? <>Lembrou sua senha? <a href="/login">Voltar para o login</a></> : <>Ainda não tem uma conta? <a href="/">Comece a treinar</a></>}</p>
              </>
            )}
          </section>
          <p className="auth-legal">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade do RangeLab.</p>
        </div>
      </section>
    </main>
  );
}
