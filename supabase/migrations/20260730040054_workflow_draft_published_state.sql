-- Versionado mínimo de flujos: un flujo en borrador se puede seguir editando
-- sin riesgo de romper una campaña en producción. Los flujos existentes quedan
-- publicados para no cambiar el comportamiento actual.
alter table public.workflows
  add column if not exists status text not null default 'published',
  add column if not exists published_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workflows_status_check' and conrelid = 'public.workflows'::regclass
  ) then
    alter table public.workflows
      add constraint workflows_status_check check (status in ('draft', 'published'));
  end if;
end $$;

update public.workflows
   set published_at = coalesce(published_at, updated_at, created_at)
 where status = 'published' and published_at is null;

comment on column public.workflows.status is 'draft = en construcción, no debería asignarse a campañas; published = operativo.';
comment on column public.workflows.published_at is 'Cuándo se publicó por última vez.';
