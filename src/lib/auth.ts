import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile as Profile | null;
}

export async function requireProfile(allowed?: Profile["role"][]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active) redirect("/login");
  if (allowed && !allowed.includes(profile.role)) redirect("/dashboard");
  return profile;
}
