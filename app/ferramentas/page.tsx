import { headers } from "next/headers";
import MemberHeader from "../member-header";
import PokerToolsExperience from "../../components/poker-tools/PokerToolsExperience";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const { getSessionUser } = await import("../../db/auth");
  const requestHeaders = await headers();
  const user = await getSessionUser(new Request("http://localhost/ferramentas", { headers: requestHeaders }));

  return <main className="member-shell tools-shell">
    <MemberHeader user={user} active="tools" />
    <PokerToolsExperience />
  </main>;
}
