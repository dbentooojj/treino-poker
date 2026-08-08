import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminStudiesExperience from "./studies-experience";

export const dynamic = "force-dynamic";

export default async function AdminStudiesPage() {
  const [{ getSessionUser }, { getStudiesAdminData }] = await Promise.all([
    import("../../../db/auth"),
    import("../../../db/studies"),
  ]);
  const requestHeaders = await headers();
  const request = new Request("http://localhost/admin/studies", { headers: requestHeaders });
  const user = await getSessionUser(request);

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const data = await getStudiesAdminData();
  return <AdminStudiesExperience user={user} data={data} />;
}
