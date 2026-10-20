import { redirect } from "next/navigation";

// Private instance: there is no public landing page. The proxy sends visitors
// without a session from /dashboard to /login.
export default function Home() {
  redirect("/dashboard");
}
