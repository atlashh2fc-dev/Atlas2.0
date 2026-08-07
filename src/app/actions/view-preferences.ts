"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Preferencias de interfaz por usuario.
 *
 * Antes vivían en `localStorage`, así que la vista era del navegador y no de la
 * persona: se perdía al cambiar de equipo y no se podía recuperar. La RLS de
 * `user_view_preferences` acota cada fila a su dueño, así que estas acciones no
 * necesitan filtrar por perfil más allá de identificarlo.
 */

export type ViewKey = "live-monitor";

export async function getMyViewPreference<T>(viewKey: ViewKey): Promise<T | null> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_view_preferences")
    .select("config")
    .eq("profile_id", profile.id)
    .eq("view_key", viewKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.config as T) ?? null;
}

export async function saveMyViewPreference(
  viewKey: ViewKey,
  config: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const profile = await requireProfile();
    const supabase = await createClient();

    const { error } = await supabase.from("user_view_preferences").upsert(
      {
        profile_id: profile.id,
        view_key: viewKey,
        config: config as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,view_key" }
    );

    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    // Perder una preferencia no puede tumbar la pantalla que la usa.
    const message = error instanceof Error ? error.message : "No se pudo guardar la vista.";
    console.error("[view-preferences.save] failed", { viewKey, error: message });
    return { ok: false, error: message };
  }
}

export type SavedView = {
  id: string;
  name: string;
  config: unknown;
  updated_at: string;
};

export async function listMySavedViews(viewKey: ViewKey): Promise<SavedView[]> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_saved_views")
    .select("id, name, config, updated_at")
    .eq("profile_id", profile.id)
    .eq("view_key", viewKey)
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []) as SavedView[];
}

/**
 * Guarda la vista actual con un nombre. Repetir un nombre sobrescribe esa
 * vista, que es lo que la persona espera al "volver a guardar".
 */
export async function saveMyNamedView(
  viewKey: ViewKey,
  name: string,
  config: unknown
): Promise<{ ok: true; view: SavedView } | { ok: false; error: string }> {
  try {
    const profile = await requireProfile();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Ponle un nombre a la vista." };
    if (trimmed.length > 60) return { ok: false, error: "El nombre no puede superar los 60 caracteres." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("user_saved_views")
      .upsert(
        {
          profile_id: profile.id,
          view_key: viewKey,
          name: trimmed,
          config: config as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id,view_key,name" }
      )
      .select("id, name, config, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return { ok: true, view: data as SavedView };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la vista.";
    return { ok: false, error: message };
  }
}

export async function deleteMySavedView(viewId: string): Promise<void> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("user_saved_views")
    .delete()
    .eq("id", viewId)
    .eq("profile_id", profile.id);

  if (error) throw new Error(error.message);
}

export async function resetMyViewPreference(viewKey: ViewKey): Promise<void> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("user_view_preferences")
    .delete()
    .eq("profile_id", profile.id)
    .eq("view_key", viewKey);

  if (error) throw new Error(error.message);
}
