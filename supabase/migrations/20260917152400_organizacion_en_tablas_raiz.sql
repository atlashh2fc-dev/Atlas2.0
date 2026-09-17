-- Multiempresa, paso 2: cada dato raíz sabe de qué empresa es.
--
-- Solo 15 tablas llevan la columna. El resto del modelo cuelga de ellas
-- (lead, campaña, equipo, flujo, conversación, perfil) y hereda la empresa por
-- esa relación, que es como ya funcionan las políticas actuales.
--
-- El valor por defecto es Geimser: todo lo que la aplicación inserta hoy sin
-- declarar empresa sigue cayendo donde corresponde, sin tocar una línea de
-- código. El paso 4 hará explícita la empresa en cada inserción.
--
-- Esta migración tampoco cambia políticas: al aplicarla, nadie ve ni deja de
-- ver nada. El aislamiento llega en el paso 3.

do $$
declare
  v_tabla text;
  v_tablas text[] := array[
    'profiles',
    'teams',
    'campaigns',
    'workflows',
    'leads',
    'crm_entities',
    'contact_center_queues',
    'whatsapp_channels',
    'historical_agents',
    'agent_status_reasons',
    'integration_sources',
    'vocalcom_import_batches',
    'staging_carga_tipificaciones',
    'staging_historial_gestiones',
    'staging_snapshots_equifax'
  ];
begin
  foreach v_tabla in array v_tablas loop
    if to_regclass(format('public.%I', v_tabla)) is null then
      raise exception 'Falta la tabla %, la migración asume el esquema de Atlas 2.0', v_tabla;
    end if;

    execute format(
      'alter table public.%I add column if not exists organization_id uuid references public.organizations(id)',
      v_tabla
    );

    execute format(
      'update public.%I set organization_id = public.default_organization_id() where organization_id is null',
      v_tabla
    );

    execute format(
      'alter table public.%I alter column organization_id set default public.default_organization_id()',
      v_tabla
    );

    execute format(
      'alter table public.%I alter column organization_id set not null',
      v_tabla
    );

    execute format(
      'create index if not exists %I on public.%I (organization_id)',
      v_tabla || '_organization_id_idx',
      v_tabla
    );
  end loop;
end
$$;

-- La membresía manda sobre la columna: si alguien queda en una empresa de la
-- que no es miembro, no podría ver su propio perfil. Esta función mantiene las
-- dos caras sincronizadas cuando la aplicación mueve a una persona de empresa.
create or replace function public.sync_profile_organization_membership()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.organization_members (organization_id, profile_id, role, is_default)
  values (new.organization_id, new.id, new.role, true)
  on conflict (organization_id, profile_id) do update
    set role = excluded.role,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_profile_organization_membership() from public;

drop trigger if exists profiles_sync_organization_membership on public.profiles;
create trigger profiles_sync_organization_membership
after insert or update of organization_id, role on public.profiles
for each row execute function public.sync_profile_organization_membership();

comment on column public.leads.organization_id is
  'Empresa dueña del lead. Geimser por defecto; Altius y futuros clientes se declaran al crear.';
comment on column public.campaigns.organization_id is
  'Empresa dueña de la campaña. Toda la operación (colas, WhatsApp, correo, reportes) hereda de acá.';
