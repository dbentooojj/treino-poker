import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Recuperar senha | RangeLab",
  description: "Solicite a recuperação da sua senha do RangeLab.",
};

export default function RecoveryPage() {
  return <AuthExperience mode="recovery" />;
}
