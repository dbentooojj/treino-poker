"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyError } from "../lib/password-policy";

type AuthMode = "login" | "recovery" | "register" | "reset";

export default function AuthExperience({ mode, token = "" }: { mode: AuthMode; token?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRecovery = mode === "recovery";
  const isRegister = mode === "register";
  const isReset = mode === "reset";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if ((isRegister || isReset) && password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (isRegister || isReset) {
      const policyError = passwordPolicyError(password);
      if (policyError) {
        setError(policyError);
        return;
      }
    }
    setLoading(true);
    try {
      const endpoint = isRecovery ? "/api/auth/recover" : isRegister ? "/api/auth/register" : isReset ? "/api/auth/reset" : "/api/auth/login";
      const payload = isRecovery ? { email } : isRegister ? { name, email, password } : isReset ? { token, password } : { email, password, remember };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { error?: string; devResetUrl?: string | null };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir esta ação.");
      if (isRecovery) {
        setDevResetUrl(data.devResetUrl ?? null);
        setSubmitted(true);
      } else if (isReset) {
        setSubmitted(true);
      } else {
        window.location.href = "/";
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível concluir esta ação.");
    } finally {
      setLoading(false);
    }
  }

  const heading = isRecovery ? "Esqueceu sua senha?" : isRegister ? "Crie sua conta" : isReset ? "Crie uma nova senha" : "Entre na sua conta";
  const eyebrow = isRecovery ? "RECUPERAR ACESSO" : isRegister ? "PRIMEIRO PASSO" : isReset ? "NOVA SENHA" : "BEM-VINDO DE VOLTA";
  const description = isRecovery
    ? "Informe o e-mail da sua conta para gerar um link seguro de redefinição."
    : isRegister
      ? "Seu progresso, histórico e pontos de estudo ficarão salvos nesta conta."
      : isReset
        ? "Use pelo menos 6 caracteres e um caractere especial. Todas as sessões anteriores serão encerradas."
        : "Continue de onde parou e mantenha seu progresso em jogo.";

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Link className="brand" href="/" aria-label="RangeLab, voltar para o início"><span className="brand-mark">R</span><span>Range<span>Lab</span></span></Link>
        <Link className="auth-back" href="/">← Voltar para o início</Link>
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
          <div className="auth-benefits"><span><i>✓</i> Histórico de treinos</span><span><i>✓</i> Leaks mapeados</span><span><i>✓</i> Evolução por conceito</span></div>
        </div>

        <div className="auth-panel-wrap">
          <section className="auth-panel" aria-labelledby="auth-title">
            {submitted ? (
              <div className="recovery-success" role="status">
                <div className="success-icon">✓</div>
                <span>{isReset ? "SENHA ATUALIZADA" : "LINK GERADO"}</span>
                <h2 id="auth-title">{isReset ? "Acesso recuperado" : "Confira as instruções"}</h2>
                <p>{isReset ? "Sua nova senha já está ativa. Entre novamente para continuar." : <>Se existir uma conta associada a <b>{email}</b>, um link de recuperação foi criado.</>}</p>
                {devResetUrl && <a className="dev-reset-link" href={devResetUrl}>Abrir link de recuperação local →</a>}
                <Link className="auth-submit" href="/login">Voltar para o login</Link>
                {!isReset && <button type="button" className="auth-text-button" onClick={() => setSubmitted(false)}>Usar outro e-mail</button>}
              </div>
            ) : (
              <>
                <div className="auth-heading"><span>{eyebrow}</span><h2 id="auth-title">{heading}</h2><p>{description}</p></div>
                <form className="auth-form" onSubmit={handleSubmit}>
                  {isRegister && <><label htmlFor="name">Nome</label><div className="auth-field"><span aria-hidden="true">◇</span><input id="name" name="name" type="text" autoComplete="name" placeholder="Como devemos chamar você?" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required autoFocus /></div></>}
                  {!isReset && <><label htmlFor="email" className={isRegister ? "auth-spaced-label" : ""}>E-mail</label><div className="auth-field"><span aria-hidden="true">@</span><input id="email" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus={!isRegister} /></div></>}

                  {!isRecovery && <>
                    <div className="auth-label-row"><label htmlFor="password">{isReset ? "Nova senha" : "Senha"}</label>{mode === "login" && <Link href="/recuperar-senha">Esqueci minha senha</Link>}</div>
                    <div className="auth-field"><span aria-hidden="true">●</span><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} placeholder="6 caracteres e 1 especial" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern="(?=.*[^A-Za-z0-9]).{6,128}" title="Use pelo menos 6 caracteres e um caractere especial" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus={isReset} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? "Ocultar" : "Mostrar"}</button></div>
                    {(isRegister || isReset) && <><label htmlFor="confirm-password" className="auth-spaced-label">Confirmar senha</label><div className="auth-field"><span aria-hidden="true">●</span><input id="confirm-password" name="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repita sua senha" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div></>}
                    {mode === "login" && <label className="remember-row"><input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Lembrar de mim neste dispositivo</span></label>}
                  </>}

                  {isReset && !token && <p className="auth-notice auth-error" role="alert">Este link de recuperação não possui um token válido.</p>}
                  {error && <p className="auth-notice auth-error" role="alert">{error}</p>}
                  <button className="auth-submit" type="submit" disabled={loading || (isReset && !token)}>{loading ? "Aguarde…" : isRecovery ? "Gerar link de recuperação" : isRegister ? "Criar minha conta" : isReset ? "Salvar nova senha" : "Entrar na conta"}<span>→</span></button>
                </form>
                <div className="auth-separator"><span>ACESSO SEGURO</span></div>
                <p className="auth-footer-copy">{isRecovery || isReset ? <>Lembrou sua senha? <Link href="/login">Voltar para o login</Link></> : isRegister ? <>Já tem uma conta? <Link href="/login">Entrar agora</Link></> : <>Ainda não tem uma conta? <Link href="/cadastro">Criar conta</Link></>}</p>
              </>
            )}
          </section>
          <p className="auth-legal">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade do RangeLab.</p>
        </div>
      </section>
    </main>
  );
}
