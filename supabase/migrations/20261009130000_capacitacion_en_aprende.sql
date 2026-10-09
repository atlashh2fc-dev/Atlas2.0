-- Capacitación: del CRM a Atlas Aprende con la misma sesión.
--
-- El ejecutivo entra a Aprende desde Atlas con un pase firmado de un solo uso
-- (src/app/capacitacion). Acá solo vive lo que Atlas necesita saber:
--   * qué curso de Aprende corresponde a cada campaña (si hay uno), para
--     llevar al vendedor directo a él;
--   * que Geimser tiene contratada la aplicación Aprende.

-- `campaigns` la lee el discador todo el tiempo: sin tope de espera, el ALTER
-- puede chocar con él (ver 20261009120000).
set local lock_timeout = '5s';

alter table public.campaigns
  add column if not exists curso_aprende text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_curso_aprende_check') then
    alter table public.campaigns
      add constraint campaigns_curso_aprende_check
      check (curso_aprende is null or curso_aprende ~ '^[a-z0-9][a-z0-9-]{0,79}$');
  end if;
end $$;

comment on column public.campaigns.curso_aprende is
  'Slug del curso de Atlas Aprende de la campaña. El botón Capacitación lleva a ese curso e inscribe al ejecutivo.';

update public.campaigns
set curso_aprende = 'mercado-pago-chile'
where name = 'Mercado Pago' and modalidad = 'terreno';

insert into public.organization_modules (organization_id, module, enabled)
select id, 'aprende', true from public.organizations where slug = 'geimser'
on conflict (organization_id, module) do update set enabled = true;
