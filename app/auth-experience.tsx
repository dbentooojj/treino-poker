"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "../components/ui/AppHeader";
import { Button, ButtonLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { StatusMessage } from "../components/ui/Primitives";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyError } from "../lib/password-policy";

type AuthMode = "login" | "recovery" | "register" | "resend" | "reset" | "verify";

export default function AuthExperience({ mode, token = "", initialEmail = "" }: { mode: AuthMode; token?: string; initialEmail?: string }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [devVerificationUrl, setDevVerificationUrl] = useState<string | null>(null);
  const [registrationEmailSent, setRegistrationEmailSent] = useState(true);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [verificationState, setVerificationState] = useState<"loading" | "success" | "error">(mode === "verify" && !token ? "error" : "loading");
  const [error, setError] = useState(mode === "verify" && !token ? "Este link de confirmação não possui um token válido." : "");
  const [loading, setLoading] = useState(false);

  const isRecovery = mode === "recovery";
  const isRegister = mode === "register";
  const isResend = mode === "resend";
  const isReset = mode === "reset";
  const isVerify = mode === "verify";
  const verificationStarted = useRef(false);

  useEffect(() => {
    if (!isVerify || verificationStarted.current) return;
    verificationStarted.current = true;
    if (!token) return;
    void (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível confirmar seu e-mail.");
        setVerificationState("success");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Não foi possível confirmar seu e-mail.");
        setVerificationState("error");
      }
    })();
  }, [isVerify, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEmailNotVerified(false);
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
      const endpoint = isRecovery ? "/api/auth/recover" : isRegister ? "/api/auth/register" : isResend ? "/api/auth/resend-verification" : isReset ? "/api/auth/reset" : "/api/auth/login";
      const payload = isRecovery || isResend ? { email } : isRegister ? { name, email, password } : isReset ? { token, password } : { email, password, remember };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { error?: string; code?: string; emailSent?: boolean; devResetUrl?: string | null; devVerificationUrl?: string | null };
      if (!response.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") setEmailNotVerified(true);
        throw new Error(data.error ?? "Não foi possível concluir esta ação.");
      }
      if (isRecovery) {
        setDevResetUrl(data.devResetUrl ?? null);
        setSubmitted(true);
      } else if (isRegister || isResend) {
        setDevVerificationUrl(data.devVerificationUrl ?? null);
        if (isRegister) setRegistrationEmailSent(data.emailSent !== false);
        setSubmitted(true);
      } else if (isReset) {
        setSubmitted(true);
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível concluir esta ação.");
    } finally {
      setLoading(false);
    }
  }

  const heading = isRecovery ? "Esqueceu sua senha?" : isRegister ? "Crie sua conta" : isResend ? "Reenviar confirmação" : isReset ? "Crie uma nova senha" : "Entre na sua conta";
  const eyebrow = isRecovery ? "RECUPERAR ACESSO" : isRegister ? "PRIMEIRO PASSO" : isResend ? "CONFIRMAR E-MAIL" : isReset ? "NOVA SENHA" : "BEM-VINDO DE VOLTA";
  const description = isRecovery
    ? "Informe o e-mail da sua conta para gerar um link seguro de redefinição."
    : isRegister
      ? "Seu progresso, histórico e pontos de estudo ficarão salvos nesta conta."
      : isResend
        ? "Informe o e-mail usado no cadastro para receber um novo link."
      : isReset
        ? "Use pelo menos 6 caracteres e um caractere especial. Todas as sessões anteriores serão encerradas."
        : "Continue de onde parou e mantenha seu progresso em jogo.";

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Brand/>
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
            {isVerify ? (
              <div className="recovery-success" role="status" aria-live="polite">
                <div className="success-icon">{verificationState === "loading" ? "…" : verificationState === "success" ? "✓" : "!"}</div>
                <span>{verificationState === "loading" ? "CONFIRMANDO" : verificationState === "success" ? "E-MAIL CONFIRMADO" : "LINK INVÁLIDO"}</span>
                <h2 id="auth-title">{verificationState === "loading" ? "Validando seu link" : verificationState === "success" ? "Conta liberada" : "Não foi possível confirmar"}</h2>
                <p>{verificationState === "loading" ? "Aguarde um instante." : verificationState === "success" ? "Seu e-mail foi confirmado. Agora você já pode entrar no RangeLab." : error}</p>
                {verificationState === "success" && <ButtonLink className="auth-submit-system" href="/login" fullWidth>Entrar na minha conta</ButtonLink>}
                {verificationState === "error" && <ButtonLink className="auth-submit-system" href="/reenviar-confirmacao" fullWidth>Solicitar novo link</ButtonLink>}
              </div>
            ) : submitted ? (
              <div className="recovery-success" role="status">
                <div className="success-icon">✓</div>
                <span>{isReset ? "SENHA ATUALIZADA" : isRegister ? "CONTA CRIADA" : "LINK GERADO"}</span>
                <h2 id="auth-title">{isReset ? "Acesso recuperado" : "Confira seu e-mail"}</h2>
                <p>{isReset ? "Sua nova senha já está ativa. Entre novamente para continuar." : isRegister ? registrationEmailSent ? <>Enviamos um link de confirmação para <b>{email}</b>. Ele é válido por 24 horas.</> : <>Sua conta foi criada, mas não conseguimos enviar o e-mail agora. Use a opção de reenvio para tentar novamente.</> : isResend ? <>Se houver uma conta pendente associada a <b>{email}</b>, um novo link foi enviado.</> : <>Se existir uma conta associada a <b>{email}</b>, um link de recuperação foi criado.</>}</p>
                {devResetUrl && <a className="dev-reset-link" href={devResetUrl}>Abrir link de recuperação local →</a>}
                {devVerificationUrl && <a className="dev-reset-link" href={devVerificationUrl}>Abrir confirmação local →</a>}
                <ButtonLink className="auth-submit-system" href="/login" fullWidth>Voltar para o login</ButtonLink>
                {isRegister && <ButtonLink href={`/reenviar-confirmacao?email=${encodeURIComponent(email)}`} variant="ghost">Reenviar confirmação</ButtonLink>}
                {!isReset && !isRegister && <Button type="button" variant="ghost" onClick={() => setSubmitted(false)}>Usar outro e-mail</Button>}
              </div>
            ) : (
              <>
                <div className="auth-heading"><span>{eyebrow}</span><h2 id="auth-title">{heading}</h2><p>{description}</p></div>
                <form className="auth-form" onSubmit={handleSubmit}>
                  {isRegister && <><label htmlFor="name">Nome</label><div className="auth-field"><span aria-hidden="true">◇</span><input id="name" name="name" type="text" autoComplete="name" placeholder="Como devemos chamar você?" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required autoFocus /></div></>}
                  {!isReset && <><label htmlFor="email" className={isRegister ? "auth-spaced-label" : ""}>E-mail</label><div className="auth-field"><span aria-hidden="true">@</span><input id="email" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus={!isRegister} /></div></>}

                  {!isRecovery && !isResend && <>
                    <div className="auth-label-row"><label htmlFor="password">{isReset ? "Nova senha" : "Senha"}</label>{mode === "login" && <Link href="/recuperar-senha">Esqueci minha senha</Link>}</div>
                    <div className="auth-field"><span aria-hidden="true">●</span><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} placeholder="6 caracteres e 1 especial" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern="(?=.*[^A-Za-z0-9]).{6,128}" title="Use pelo menos 6 caracteres e um caractere especial" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus={isReset} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? "Ocultar" : "Mostrar"}</button></div>
                    {(isRegister || isReset) && <><label htmlFor="confirm-password" className="auth-spaced-label">Confirmar senha</label><div className="auth-field"><span aria-hidden="true">●</span><input id="confirm-password" name="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repita sua senha" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div></>}
                    {mode === "login" && <label className="remember-row"><input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Lembrar de mim neste dispositivo</span></label>}
                  </>}

                  {isReset && !token && <StatusMessage className="auth-status" tone="error">Este link de recuperação não possui um token válido.</StatusMessage>}
                  {error && <StatusMessage className="auth-status" tone="error">{error}</StatusMessage>}
                  {emailNotVerified && <ButtonLink href={`/reenviar-confirmacao?email=${encodeURIComponent(email)}`} variant="secondary" fullWidth>Reenviar confirmação</ButtonLink>}
                  <Button className="auth-submit-system" type="submit" fullWidth loading={loading} disabled={isReset && !token}>{isRecovery ? "Gerar link de recuperação" : isRegister ? "Criar minha conta" : isResend ? "Enviar novo link" : isReset ? "Salvar nova senha" : "Entrar na conta"}<Icon name="arrowRight"/></Button>
                </form>
                <div className="auth-separator"><span>ACESSO SEGURO</span></div>
                <p className="auth-footer-copy">{isRecovery || isResend || isReset ? <>Já pode acessar? <Link href="/login">Voltar para o login</Link></> : isRegister ? <>Já tem uma conta? <Link href="/login">Entrar agora</Link></> : <>Ainda não tem uma conta? <Link href="/cadastro">Criar conta</Link></>}</p>
              </>
            )}
          </section>
          <p className="auth-legal">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade do RangeLab.</p>
        </div>
      </section>
    </main>
  );
}
