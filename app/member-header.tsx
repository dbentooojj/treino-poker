import type { AuthUser } from "../db/auth";
import AppHeader from "../components/ui/AppHeader";

export default function MemberHeader({ user, active }: { user: AuthUser | null; active?: "account" | "progress" | "tools" | "training" }) {
  return <AppHeader user={user} active={active ?? "home"}/>;
}
