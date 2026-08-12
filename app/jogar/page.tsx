import { redirect } from "next/navigation";

export default function PlayPage() {
  redirect("/treinar?modo=mao-completa");
}
