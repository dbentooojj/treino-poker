import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MemberHeader from "../member-header";
import ProgressExperience from "./progress-experience";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const [{ getSessionUser }, { getProgressDashboard }] = await Promise.all([
    import("../../db/auth"),
    import("../../db/progress"),
  ]);
  const requestHeaders = await headers();
  const user = await getSessionUser(new Request("http://localhost/progresso", { headers: requestHeaders }));
  if (!user) redirect("/login");
  const progress = await getProgressDashboard(user.id);

  return <main className="member-shell progress-shell">
    <MemberHeader user={user} active="progress" />
    <ProgressExperience data={progress} />
  </main>;
}
