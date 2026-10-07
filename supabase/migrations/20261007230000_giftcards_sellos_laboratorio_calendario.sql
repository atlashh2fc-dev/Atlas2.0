-- Giftcards, tarjeta de sellos, órdenes de laboratorio y calendario.
--
-- 1. Giftcards: se venden en el mesón con un código, tienen saldo y se
--    canjean en una o varias visitas. Cada movimiento queda registrado.
-- 2. Tarjeta de sellos: cada visita atendida suma un sello; al llegar a la
--    meta la persona gana el premio que la empresa definió y la recepción lo
--    canjea desde la ficha.
-- 3. Órdenes de laboratorio (Dental): qué trabajo se mandó, a qué
--    laboratorio, cuándo vuelve y en qué estado está.
-- 4. Calendario: cada profesional tiene un enlace privado para ver su agenda
--    en Google Calendar, Apple o Outlook (formato iCalendar), sin cuenta.

-- ---------------------------------------------------------------------------
-- Giftcards.
-- ---------------------------------------------------------------------------
create table if not exists public.giftcards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  codigo text not null,
  monto_inicial numeric not null,
  saldo numeric not null,
  comprador_id uuid references public.sales_companies(id) on delete set null,
  para text,
  vence date,
  estado text not null default 'activa',
  medio text not null,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint giftcards_monto_check check (monto_inicial > 0 and saldo >= 0 and saldo <= monto_inicial),
  constraint giftcards_estado_check check (estado in ('activa', 'usada', 'anulada')),
  constraint giftcards_medio_check check (medio in ('efectivo', 'debito', 'credito', 'transferencia', 'otro')),
  constraint giftcards_codigo_unico unique (organization_id, codigo)
);

create table if not exists public.giftcard_movimientos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  giftcard_id uuid not null references public.giftcards(id) on delete cascade,
  cuenta_id uuid references public.sales_companies(id) on delete set null,
  monto numeric not null,
  nota text,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint giftcard_movimientos_monto_check check (monto > 0)
);

alter table public.giftcards enable row level security;
alter table public.giftcard_movimientos enable row level security;

drop policy if exists giftcards_organization_isolation on public.giftcards;
create policy giftcards_organization_isolation on public.giftcards
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists giftcards_rw on public.giftcards;
create policy giftcards_rw on public.giftcards
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

drop policy if exists giftcard_movimientos_organization_isolation on public.giftcard_movimientos;
create policy giftcard_movimientos_organization_isolation on public.giftcard_movimientos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists giftcard_movimientos_rw on public.giftcard_movimientos;
create policy giftcard_movimientos_rw on public.giftcard_movimientos
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- Vender: código corto legible (sin 0/O/1/I), único por empresa.
create or replace function public.vender_giftcard(p_monto numeric, p_medio text, p_para text default null, p_comprador uuid default null, p_vence date default null)
returns text
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_codigo text;
  v_letras text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_intento integer := 0;
begin
  if v_org is null then raise exception 'Elige una empresa' using errcode = '22023'; end if;
  if p_monto is null or p_monto < 1000 or p_monto > 5000000 then raise exception 'El monto va de $1.000 a $5.000.000' using errcode = '22023'; end if;
  if p_medio not in ('efectivo', 'debito', 'credito', 'transferencia', 'otro') then raise exception 'Elige el medio de pago' using errcode = '22023'; end if;
  loop
    v_intento := v_intento + 1;
    v_codigo := '';
    for i in 1..8 loop
      v_codigo := v_codigo || substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1);
    end loop;
    v_codigo := substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4);
    exit when not exists (select 1 from public.giftcards where organization_id = v_org and codigo = v_codigo) or v_intento > 20;
  end loop;
  insert into public.giftcards (organization_id, codigo, monto_inicial, saldo, comprador_id, para, vence, medio, creado_por)
  values (v_org, v_codigo, round(p_monto), round(p_monto), p_comprador, nullif(btrim(coalesce(p_para, '')), ''),
          coalesce(p_vence, ((now() at time zone 'America/Santiago')::date + 365)), p_medio, auth.uid());
  return v_codigo;
end;
$$;
revoke all on function public.vender_giftcard(numeric, text, text, uuid, date) from public, anon;
grant execute on function public.vender_giftcard(numeric, text, text, uuid, date) to authenticated;

-- Canjear: descuenta del saldo, nunca bajo cero, y deja el movimiento.
create or replace function public.canjear_giftcard(p_codigo text, p_monto numeric, p_cuenta uuid default null)
returns numeric
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_card public.giftcards%rowtype;
begin
  select * into v_card from public.giftcards
   where organization_id = public.current_org_id() and codigo = upper(btrim(p_codigo))
   for update;
  if not found then raise exception 'No encontramos esa giftcard' using errcode = 'P0002'; end if;
  if v_card.estado <> 'activa' then raise exception 'Esa giftcard ya está %', case v_card.estado when 'usada' then 'usada' else 'anulada' end using errcode = '22023'; end if;
  if v_card.vence is not null and v_card.vence < (now() at time zone 'America/Santiago')::date then raise exception 'Esa giftcard venció el %', to_char(v_card.vence, 'DD/MM/YYYY') using errcode = '22023'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Escribe el monto a usar' using errcode = '22023'; end if;
  if p_monto > v_card.saldo then raise exception 'El saldo es %: no alcanza', to_char(v_card.saldo, 'FM$999G999G999') using errcode = '22023'; end if;
  update public.giftcards set saldo = saldo - round(p_monto), estado = case when saldo - round(p_monto) <= 0 then 'usada' else 'activa' end where id = v_card.id;
  insert into public.giftcard_movimientos (organization_id, giftcard_id, cuenta_id, monto, creado_por)
  values (v_card.organization_id, v_card.id, p_cuenta, round(p_monto), auth.uid());
  if p_cuenta is not null then
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_card.organization_id, p_cuenta, 'nota', 'Usó giftcard ' || v_card.codigo, to_char(p_monto, 'FM$999G999G999') || ' · saldo ' || to_char(v_card.saldo - round(p_monto), 'FM$999G999G999'), now(), true, auth.uid());
  end if;
  return v_card.saldo - round(p_monto);
end;
$$;
revoke all on function public.canjear_giftcard(text, numeric, uuid) from public, anon;
grant execute on function public.canjear_giftcard(text, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tarjeta de sellos.
-- ---------------------------------------------------------------------------
alter table public.configuracion_agenda add column if not exists sellos_activa boolean not null default false;
alter table public.configuracion_agenda add column if not exists sellos_meta integer not null default 10;
alter table public.configuracion_agenda add column if not exists sellos_premio text;
alter table public.configuracion_agenda drop constraint if exists configuracion_agenda_sellos_check;
alter table public.configuracion_agenda add constraint configuracion_agenda_sellos_check check (sellos_meta between 2 and 50 and (sellos_premio is null or length(sellos_premio) <= 120));

create table if not exists public.canjes_sellos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  premio text not null,
  sellos integer not null,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.canjes_sellos enable row level security;
drop policy if exists canjes_sellos_organization_isolation on public.canjes_sellos;
create policy canjes_sellos_organization_isolation on public.canjes_sellos
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists canjes_sellos_rw on public.canjes_sellos;
create policy canjes_sellos_rw on public.canjes_sellos
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- Sellos de una ficha: un sello por día con atención desde el último canje.
create or replace function public.sellos_de_ficha(p_cuenta uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $$
  with cfg as (
    select coalesce(c.sellos_activa, false) as activa, coalesce(c.sellos_meta, 10) as meta, c.sellos_premio as premio
      from public.sales_companies s
      left join public.configuracion_agenda c on c.organization_id = s.organization_id
     where s.id = p_cuenta
  ), ultimo as (
    select max(created_at) as fecha from public.canjes_sellos where cuenta_id = p_cuenta
  )
  select jsonb_build_object(
    'activa', cfg.activa, 'meta', cfg.meta, 'premio', cfg.premio,
    'sellos', (select count(distinct a.fecha) from public.atenciones a, ultimo
                where a.cuenta_id = p_cuenta and (ultimo.fecha is null or a.created_at > ultimo.fecha)),
    'canjes', (select count(*) from public.canjes_sellos where cuenta_id = p_cuenta))
  from cfg;
$$;
revoke all on function public.sellos_de_ficha(uuid) from public, anon;
grant execute on function public.sellos_de_ficha(uuid) to authenticated;

create or replace function public.canjear_sellos(p_cuenta uuid)
returns void
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_estado jsonb := public.sellos_de_ficha(p_cuenta);
  v_org uuid;
begin
  if v_estado is null or not (v_estado->>'activa')::boolean then raise exception 'La tarjeta de sellos no está activa' using errcode = '22023'; end if;
  if (v_estado->>'sellos')::int < (v_estado->>'meta')::int then raise exception 'Todavía no completa la tarjeta' using errcode = '22023'; end if;
  select organization_id into v_org from public.sales_companies where id = p_cuenta;
  insert into public.canjes_sellos (organization_id, cuenta_id, premio, sellos, creado_por)
  values (v_org, p_cuenta, coalesce(v_estado->>'premio', 'Premio'), (v_estado->>'sellos')::int, auth.uid());
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
  values (v_org, p_cuenta, 'nota', 'Canjeó su tarjeta de sellos', coalesce(v_estado->>'premio', 'Premio'), now(), true, auth.uid());
end;
$$;
revoke all on function public.canjear_sellos(uuid) from public, anon;
grant execute on function public.canjear_sellos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Órdenes de laboratorio.
-- ---------------------------------------------------------------------------
create table if not exists public.ordenes_laboratorio (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  laboratorio text not null,
  trabajo text not null,
  piezas text,
  color text,
  profesional_id uuid references public.profesionales(id) on delete set null,
  enviada_el date not null default ((now() at time zone 'America/Santiago')::date),
  entrega_estimada date,
  estado text not null default 'enviada',
  costo numeric,
  nota text,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ordenes_laboratorio_estado_check check (estado in ('enviada', 'en_prueba', 'recibida', 'instalada', 'cancelada')),
  constraint ordenes_laboratorio_textos check (btrim(laboratorio) <> '' and btrim(trabajo) <> '')
);
create index if not exists ordenes_laboratorio_org_idx on public.ordenes_laboratorio (organization_id, estado, entrega_estimada);
alter table public.ordenes_laboratorio enable row level security;
drop policy if exists ordenes_laboratorio_organization_isolation on public.ordenes_laboratorio;
create policy ordenes_laboratorio_organization_isolation on public.ordenes_laboratorio
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));
drop policy if exists ordenes_laboratorio_rw on public.ordenes_laboratorio;
create policy ordenes_laboratorio_rw on public.ordenes_laboratorio
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Calendario del profesional (iCalendar), por enlace privado.
-- ---------------------------------------------------------------------------
alter table public.profesionales add column if not exists calendario_token text;
update public.profesionales set calendario_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where calendario_token is null;
alter table public.profesionales alter column calendario_token set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists profesionales_calendario_token_uidx on public.profesionales (calendario_token) where calendario_token is not null;

-- Lo justo para un calendario: hora, motivo y el primer nombre (sin teléfono
-- ni datos clínicos), de 7 días atrás a 60 días adelante.
create or replace function public.calendario_de_profesional(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select jsonb_build_object(
    'profesional', pr.nombre,
    'empresa', organizacion.name,
    'citas', coalesce((
      select jsonb_agg(jsonb_build_object('id', cita.id, 'inicio', cita.inicio, 'fin', cita.fin, 'motivo', cita.motivo, 'estado', cita.estado,
                                          'persona', split_part(cuenta.name, ' ', 1), 'mascota', mascota.nombre, 'box', cita.box) order by cita.inicio)
        from public.citas cita
        join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
        left join public.mascotas mascota on mascota.id = cita.mascota_id
       where cita.profesional_id = pr.id
         and cita.estado not in ('cancelada', 'no_vino')
         and cita.inicio between now() - interval '7 days' and now() + interval '60 days'), '[]'::jsonb))
    from public.profesionales pr
    join public.organizations organizacion on organizacion.id = pr.organization_id
   where length(coalesce(p_token, '')) >= 32 and pr.calendario_token = p_token and pr.activo;
$$;
revoke all on function public.calendario_de_profesional(text) from public;
grant execute on function public.calendario_de_profesional(text) to anon, authenticated;

-- Demos: sellos activos en barbería y plantillas de consentimiento sugeridas listas.
insert into public.configuracion_agenda (organization_id, sellos_activa, sellos_meta, sellos_premio)
select id, true, 8, 'Corte gratis' from public.organizations where slug = 'demo-barber'
on conflict (organization_id) do update set sellos_activa = true, sellos_meta = 8, sellos_premio = coalesce(public.configuracion_agenda.sellos_premio, 'Corte gratis');
