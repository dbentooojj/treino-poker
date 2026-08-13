import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Confirmar e-mail | RangeLab",
  description: "Confirme o e-mail da sua conta do RangeLab.",
};

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <AuthExperience mode="verify" token={token} />;
}
