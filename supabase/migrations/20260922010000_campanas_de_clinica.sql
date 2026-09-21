-- Campañas de la clínica.
--
-- Una campaña es un segmento de la propia clínica (vacunas por vencer,
-- pacientes sin control, presupuestos abiertos, una especie, cumpleaños de
-- mascotas), un mensaje y una fecha. No inventa otra cola: al lanzarse deja
-- un mensaje saliente por destinatario, y el despacho de siempre los manda
-- por WhatsApp o correo. Los resultados se leen de esos mismos mensajes.

create table if not exists public.campanas_de_clinica (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  nombre text not null,
  segmento text not null,
  parametros jsonb not null default '{}'::jsonb,
  -- whatsapp, correo, o auto: WhatsApp si hay celular, correo si no.
  canal text not null default 'auto',
  asunto text,
  texto text not null,
  programada_para timestamptz,
  estado text not null default 'borrador',
  destinatarios integer not null default 0,
  lanzada_at timestamptz,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campanas_nombre_not_blank check (btrim(nombre) <> ''),
  constraint campanas_texto_not_blank check (btrim(texto) <> ''),
  constraint campanas_canal_check check (canal in ('auto', 'whatsapp', 'correo')),
  constraint campanas_estado_check check (estado in ('borrador', 'programada', 'enviada', 'cancelada')),
  constraint campanas_segmento_check check (segmento in ('todos', 'vacuna_por_vencer', 'sin_control', 'presupuesto_abierto', 'especie', 'cumple_mascota'))
);

create index if not exists campanas_de_clinica_org_idx on public.campanas_de_clinica (organization_id, created_at desc);

alter table public.campanas_de_clinica enable row level security;

drop policy if exists campanas_de_clinica_organization_isolation on public.campanas_de_clinica;
create policy campanas_de_clinica_organization_isolation on public.campanas_de_clinica
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists campanas_de_clinica_rw on public.campanas_de_clinica;
create policy campanas_de_clinica_rw on public.campanas_de_clinica
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Quién entra en un segmento. Corre con la sesión de quien mira: la seguridad
-- por fila decide la empresa. Solo fichas con algún canal.
-- ---------------------------------------------------------------------------
create or replace function public.destinatarios_de_segmento(p_segmento text, p_parametros jsonb default '{}'::jsonb)
returns table (cuenta_id uuid, nombre text, telefono text, email text, mascota text)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $$
  with hoy as (select (now() at time zone 'America/Santiago')::date as dia),
  base as (
    select cuenta.id, cuenta.name, nullif(btrim(coalesce(cuenta.phone, '')), '') as telefono, nullif(btrim(coalesce(cuenta.email, '')), '') as email
      from public.sales_companies cuenta
     where cuenta.organization_id = public.current_org_id()
  )
  select distinct on (base.id) base.id, base.name, base.telefono, base.email, mascota.nombre
    from base
    left join public.mascotas mascota on mascota.cuenta_id = base.id
    cross join hoy
   where (base.telefono is not null or base.email is not null)
     and case p_segmento
       when 'todos' then true
       when 'vacuna_por_vencer' then mascota.proxima_vacuna is not null
            and mascota.proxima_vacuna between hoy.dia - 60 and hoy.dia + coalesce((p_parametros->>'dias')::integer, 30)
       when 'sin_control' then exists (select 1 from public.atenciones a where a.cuenta_id = base.id)
            and not exists (select 1 from public.atenciones a where a.cuenta_id = base.id and a.fecha >= hoy.dia - 30 * coalesce((p_parametros->>'meses')::integer, 6))
       when 'presupuesto_abierto' then exists (select 1 from public.sales_opportunities n where n.company_id = base.id and n.status = 'abierta')
       when 'especie' then mascota.especie = coalesce(p_parametros->>'especie', 'Perro')
       when 'cumple_mascota' then mascota.nacimiento is not null
            and extract(month from mascota.nacimiento) = coalesce((p_parametros->>'mes')::integer, extract(month from hoy.dia)::integer)
       else false
     end
   order by base.id, mascota.proxima_vacuna nulls last, mascota.nombre;
$$;

revoke all on function public.destinatarios_de_segmento(text, jsonb) from public, anon;
grant execute on function public.destinatarios_de_segmento(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Lanzar: un mensaje saliente por destinatario, con el texto ya personalizado
-- (nombre, mascota, clínica). El despacho de siempre los manda.
-- ---------------------------------------------------------------------------
create or replace function public.lanzar_campana_de_clinica(p_campana uuid)
returns integer
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campana public.campanas_de_clinica%rowtype;
  v_clinica text;
  v_n integer := 0;
  v_destinatario record;
  v_canal text;
  v_texto text;
begin
  select * into v_campana from public.campanas_de_clinica where id = p_campana for update;
  if not found then
    raise exception 'No encontramos esa campaña' using errcode = 'P0002';
  end if;
  if v_campana.estado not in ('borrador', 'programada') then
    raise exception 'La campaña ya se lanzó o fue cancelada' using errcode = '22023';
  end if;
  select name into v_clinica from public.organizations where id = v_campana.organization_id;

  for v_destinatario in select * from public.destinatarios_de_segmento(v_campana.segmento, v_campana.parametros) loop
    v_canal := case
      when v_campana.canal = 'whatsapp' then case when v_destinatario.telefono is not null then 'whatsapp' else null end
      when v_campana.canal = 'correo' then case when v_destinatario.email is not null then 'correo' else null end
      else case when v_destinatario.telefono is not null then 'whatsapp' else 'correo' end
    end;
    if v_canal is null then continue; end if;
    v_texto := replace(replace(replace(v_campana.texto, '{{nombre}}', split_part(v_destinatario.nombre, ' ', 1)),
                               '{{mascota}}', coalesce(v_destinatario.mascota, 'tu mascota')),
                       '{{clinica}}', coalesce(v_clinica, 'la clínica'));
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe,
                                           plantilla, variables, asunto, programado_para, creado_por)
    values (v_campana.organization_id, v_canal, v_destinatario.cuenta_id,
            case when v_canal = 'whatsapp' then v_destinatario.telefono else v_destinatario.email end,
            v_destinatario.nombre, 'campana', v_campana.id, 'campana:' || v_campana.id || ':' || v_destinatario.cuenta_id,
            'libre', jsonb_build_object('texto', v_texto), v_campana.asunto,
            coalesce(v_campana.programada_para, now()), auth.uid())
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;

  update public.campanas_de_clinica
     set estado = case when coalesce(programada_para, now()) > now() then 'programada' else 'enviada' end,
         destinatarios = v_n, lanzada_at = now(), updated_at = now()
   where id = p_campana;
  return v_n;
end;
$$;

revoke all on function public.lanzar_campana_de_clinica(uuid) from public, anon;
grant execute on function public.lanzar_campana_de_clinica(uuid) to authenticated;
