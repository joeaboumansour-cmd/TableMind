import { redirect } from "next/navigation";

export default function SettingsPage() {
  // Redirect to tables settings as the default settings page
  redirect("/settings/tables");
}
