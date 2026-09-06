import { redirect } from "next/navigation";

/** The workspace lives under /project/[id] now. The root goes to the dashboard. */
export default function Home() {
  redirect("/dashboard");
}
