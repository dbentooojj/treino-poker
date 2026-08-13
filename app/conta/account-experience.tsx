"use client";

import { FormEvent, useState } from "react";
import type { AuthUser } from "../../db/auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyError } from "../../lib/password-policy";
import { Button } from "../../components/ui/Button";
import { PageContainer, PageHeader, StatusMessage } from "../../components/ui/Primitives";
import MemberHeader from "../member-header";

export default function AccountExperience({ initialUser }: { initialUser: AuthUser }) {
  const [user, setUser] = useState(initialUser);
  const [name, setName] = useState(initialUser.name);
  const [email, setEmail] = useState(initialUser.email);
  const [profilePassword, setProfilePassword] = useState("");
  const [profileState, setProfileState] = useState({ loading: false, error: "", success: "" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordState, setPasswordState] = useState({ loading: false, error: "", success: "" });

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileState({ loading: true, error: "", success: "" });
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, currentPassword: profilePassword }),
      });
      const data = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error ?? "Não foi possível salvar seus dados.");
      setUser(data.user);
      setName(data.user.name);
      setEmail(data.user.email);
      setProfilePassword("");
      setProfileState({ loading: false, error: "", success: "Dados atualizados com sucesso." });
    } catch (error) {
      setProfileState({ loading: false, error: error instanceof Error ? error.message : "Não foi possível salvar seus dados.", success: "" });
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordState({ loading: false, error: "", success: "" });
    if (newPassword !== confirmPassword) {
      setPasswordState({ loading: false, error: "As novas senhas não coincidem.", success: "" });
      return;
    }
    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      setPasswordState({ loading: false, error: policyError, success: "" });
      return;
    }
    setPasswordState({ loading: true, error: "", success: "" });
    try {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível trocar sua senha.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordState({ loading: false, error: "", success: "Senha alterada. Por segurança, entre novamente." });
    } catch (error) {
      setPasswordState({ loading: false, error: error instanceof Error ? error.message : "Não foi possível trocar sua senha.", success: "" });
    }
  }

  return <main className="member-shell">
    <MemberHeader user={user} active="account" />
    <PageContainer width="compact">
      <PageHeader eyebrow="Minha conta" title="Seus dados, do seu jeito." description="Atualize suas informações de acesso e mantenha a conta protegida."/>
      <div className="account-grid">
        <section className="settings-card" aria-labelledby="profile-title">
          <div className="settings-card-heading"><i aria-hidden="true">U</i><div><span>PERFIL</span><h2 id="profile-title">Dados pessoais</h2><p>Estas informações aparecem na sua conta.</p></div></div>
          <form className="settings-form" onSubmit={updateProfile}>
            <label htmlFor="account-name">Nome</label>
            <input id="account-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required />
            <label htmlFor="account-email">E-mail</label>
            <input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="profile-password">Senha atual <small>necessária somente ao trocar o e-mail</small></label>
            <input id="profile-password" type="password" value={profilePassword} onChange={(event) => setProfilePassword(event.target.value)} autoComplete="current-password" placeholder="Confirme para alterar o e-mail" />
            {profileState.error && <StatusMessage className="settings-status" tone="error">{profileState.error}</StatusMessage>}
            {profileState.success && <StatusMessage className="settings-status" tone="success">{profileState.success}</StatusMessage>}
            <Button className="settings-submit-system" type="submit" fullWidth loading={profileState.loading}>Salvar alterações</Button>
          </form>
        </section>

        <section className="settings-card" aria-labelledby="password-title">
          <div className="settings-card-heading"><i aria-hidden="true">◇</i><div><span>SEGURANÇA</span><h2 id="password-title">Trocar senha</h2><p>Ao trocar a senha, suas sessões serão encerradas.</p></div></div>
          <form className="settings-form" onSubmit={updatePassword}>
            <label htmlFor="current-password">Senha atual</label>
            <input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            <label htmlFor="new-password">Nova senha</label>
            <input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required />
            <label htmlFor="confirm-new-password">Confirmar nova senha</label>
            <input id="confirm-new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required />
            <p className="settings-hint">Use pelo menos {PASSWORD_MIN_LENGTH} caracteres e um caractere especial.</p>
            {passwordState.error && <StatusMessage className="settings-status" tone="error">{passwordState.error}</StatusMessage>}
            {passwordState.success && <StatusMessage className="settings-status" tone="success">{passwordState.success} <a href="/login">Ir para o login</a></StatusMessage>}
            <Button className="settings-submit-system" type="submit" variant="secondary" fullWidth loading={passwordState.loading} disabled={Boolean(passwordState.success)}>Alterar senha</Button>
          </form>
        </section>
      </div>
    </PageContainer>
  </main>;
}
