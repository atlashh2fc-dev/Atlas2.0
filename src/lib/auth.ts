import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Profile } from "@/lib/types";

/**
 * Layouts and pages call this helper independently during the same render.
 * React cache keeps that render to one auth/session/profile round-trip instead
 * of repeating the three requests at every nested dashboard boundary.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sessionValid, error: sessionError } = await supabase.rpc(
    "is_current_app_session_valid"
  );
  if (sessionError) throw new Error(sessionError.message);
  if (!sessionValid) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile as Profile | null;
});

export async function requireProfile(allowed?: Profile["role"][]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active) redirect("/login");
  if (allowed && !allowed.includes(profile.role)) redirect("/dashboard");
  return profile;
}
