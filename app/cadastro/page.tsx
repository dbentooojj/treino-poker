import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Criar conta | RangeLab",
  description: "Crie sua conta local no RangeLab.",
};

export default function RegisterPage() {
  return <AuthExperience mode="register" />;
}
