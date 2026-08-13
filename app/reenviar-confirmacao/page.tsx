import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Reenviar confirmação | RangeLab",
  description: "Solicite um novo link de confirmação para sua conta do RangeLab.",
};

export default async function ResendConfirmationPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = "" } = await searchParams;
  return <AuthExperience mode="resend" initialEmail={email} />;
}
