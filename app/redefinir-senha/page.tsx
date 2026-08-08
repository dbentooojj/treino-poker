import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Redefinir senha | RangeLab",
  description: "Defina uma nova senha para sua conta do RangeLab.",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <AuthExperience mode="reset" token={token} />;
}
