-- Las funciones de trigger del Estudio de Look no se llaman por RPC.
revoke all on function public.look_exige_consentimiento() from public, anon, authenticated;
revoke all on function public.look_al_dia() from public, anon, authenticated;
