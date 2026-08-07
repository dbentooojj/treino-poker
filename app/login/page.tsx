import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = {
  title: "Entrar | RangeLab",
  description: "Entre no RangeLab e continue sua evolução no poker.",
};

export default function LoginPage() {
  return <AuthExperience mode="login" />;
}
