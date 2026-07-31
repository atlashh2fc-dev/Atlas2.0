-- pgcrypto vive en `extensions` en el proyecto alojado. La función conserva
-- search_path explícito, pero debe incluir ese esquema para gen_random_bytes.
alter function public.force_agent_logout(uuid, text)
  set search_path = public, auth, pg_catalog, extensions;
