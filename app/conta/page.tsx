import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AccountExperience from "./account-experience";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { getSessionUser } = await import("../../db/auth");
  const requestHeaders = await headers();
  const user = await getSessionUser(new Request("http://localhost/conta", { headers: requestHeaders }));
  if (!user) redirect("/login");
  return <AccountExperience initialUser={user} />;
}
