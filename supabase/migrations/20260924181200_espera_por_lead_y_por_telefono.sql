-- Cuándo se puede volver a marcar un lead: se calcula al terminar cada
-- intento, no en cada ciclo del discador.
--
-- Antes claim_next_dial_targets recalculaba en cada ciclo (cada 3 s) los
-- intentos de toda la campaña y comparaba el teléfono canónico de las 80 mil
-- filas de la cola: ~0,9 s por ciclo, y aun así no contaba como intento una
-- llamada 'completed' sin contestar, 'abandoned' ni un descarte técnico.
--
-- Ahora cada intento terminado deja escrito en el lead, y en los demás leads
-- de la empresa con el mismo teléfono, desde cuándo se les puede volver a
-- llamar (leads.dialer_retry_at). El claim solo lee esa columna con índices:
-- la cola fresca por prioridad y los reintentos ya vencidos.
--
-- Reglas (política en dialer_campaign_configs, 20260924181000):
--   * Todo intento terminado cuenta, salvo el que terminó en una tipificación
--     humana. Una gestión humana (leads.managed_at) abre un ciclo nuevo.
--   * Espera escalonada por intentos del ciclo (30 min, 2 h, 24 h por
--     defecto). Tras un abandono (contestó y no había ejecutivo) se usa el
--     último escalón.
--   * Máximo max_redial_attempts intentos en 7 días corridos.
--   * Al llegar a max_uncontacted_attempts el lead sale de la cola:
--     dialer_retry_at = 'infinity' hasta la próxima gestión humana.
--   * Por teléfono: si otro lead de la empresa con el mismo número se llamó
--     hace poco, se espera igual; si esa persona habló con un ejecutivo, un
--     día completo.
--   * Teléfono en la lista de no llamar: 'infinity' (o hasta que venza).

alter table public.leads add column if not exists dialer_retry_at timestamptz;

comment on column public.leads.dialer_retry_at is
  'Desde cuándo el discador puede volver a marcar este lead (espera por lead y por teléfono, tope de intentos o lista de no llamar). null = sin espera; infinity = fuera de la cola hasta una gestión humana o hasta levantar la supresión.';

-- Leads de la empresa por teléfono canónico: para propagar la espera a los que
-- comparten número y para cruzar la lista de no llamar.
create index if not exists leads_organization_phone_key_idx
  on public.leads (organization_id, public.canonical_chile_phone(phone))
  where phone is not null;

-- La cola fresca en el orden exacto del discador; solo contiene lo que el pool
-- puede marcar, así el claim deja de recorrer los gestionados.
create index if not exists leads_dialer_fresh_queue_idx
  on public.leads (campaign_id, external_priority_rank, updated_at)
  where phone is not null
    and btrim(phone) <> ''
    and dialer_retry_at is null
    and next_action_at is null
    and coalesce(assignment_status, 'pending') not in ('managed', 'exception')
    and coalesce(workflow_status, 'pending') not in ('managed', 'exception', 'callback');

create index if not exists leads_dialer_retry_idx
  on public.leads (campaign_id, dialer_retry_at)
  where dialer_retry_at is not null;

-- Historial reciente por teléfono, para la espera entre leads distintos.
create index if not exists dial_attempts_phone_history_idx
  on public.dial_attempts (public.canonical_chile_phone(phone), ended_at desc)
  where ended_at is not null;

-- ---------------------------------------------------------------------------
-- El cálculo. Lee la fuente de verdad (dial_attempts, la lista de no llamar y
-- la configuración); no guarda contadores que se puedan desfasar.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_compute_lead_retry_at(
  p_lead_id uuid,
  p_organization_id uuid,
  p_campaign_id uuid,
  p_phone text,
  p_managed_at timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_now timestamptz := now();
  v_phone text := public.canonical_chile_phone(p_phone);
  v_ladder integer[];
  v_max_redial integer;
  v_cap integer;
  v_cycle_start timestamptz := coalesce(p_managed_at, '-infinity'::timestamptz);
  v_until timestamptz := '-infinity'::timestamptz;
  v_suppressed_until timestamptz;
  v_count integer;
  v_week_ends timestamptz[];
  v_last record;
  v_other record;
begin
  if p_lead_id is null or p_campaign_id is null then
    return null;
  end if;

  select config.redial_backoff_minutes, config.max_redial_attempts, config.max_uncontacted_attempts
  into v_ladder, v_max_redial, v_cap
  from public.dialer_campaign_configs config
  where config.campaign_id = p_campaign_id;
  v_ladder := coalesce(v_ladder, '{30,120,1440}'::integer[]);
  v_max_redial := coalesce(v_max_redial, 4);

  -- Lista de no llamar: gana sobre todo lo demás.
  if v_phone is not null and p_organization_id is not null then
    select max(coalesce(suppression.expires_at, 'infinity'::timestamptz))
    into v_suppressed_until
    from public.dialer_phone_suppressions suppression
    where suppression.organization_id = p_organization_id
      and suppression.phone = v_phone
      and suppression.lifted_at is null
      and (suppression.expires_at is null or suppression.expires_at > v_now)
      and (suppression.campaign_id is null or suppression.campaign_id = p_campaign_id);
    if v_suppressed_until = 'infinity'::timestamptz then
      return v_suppressed_until;
    end if;
    v_until := greatest(v_until, coalesce(v_suppressed_until, '-infinity'::timestamptz));
  end if;

  -- Intentos del ciclo que no terminaron en una tipificación humana. Uno que
  -- se tipificó con la llamada todavía abierta (puente antes de managed_at) es
  -- contacto, no intento.
  select
    count(*)::integer,
    array_agg(attempt.ended_at order by attempt.ended_at desc)
      filter (where attempt.ended_at > v_now - interval '7 days')
  into v_count, v_week_ends
  from public.dial_attempts attempt
  where attempt.lead_id = p_lead_id
    and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed')
    and attempt.ended_at > v_cycle_start
    and not (attempt.bridged_at is not null and attempt.bridged_at <= v_cycle_start);

  if v_count > 0 then
    if v_cap is not null and v_count >= v_cap then
      return 'infinity'::timestamptz;
    end if;

    select
      attempt.ended_at,
      (attempt.status = 'abandoned' or (attempt.answered_at is not null and attempt.bridged_at is null)) as silent
    into v_last
    from public.dial_attempts attempt
    where attempt.lead_id = p_lead_id
      and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed')
      and attempt.ended_at > v_cycle_start
      and not (attempt.bridged_at is not null and attempt.bridged_at <= v_cycle_start)
    order by attempt.ended_at desc
    limit 1;

    v_until := greatest(
      v_until,
      v_last.ended_at + make_interval(mins => public.dialer_backoff_minutes(v_ladder, v_count, v_last.silent))
    );

    -- Ventana móvil de 7 días: se libera cuando sale de ella el intento que
    -- completó el cupo.
    if v_max_redial >= 1 and coalesce(cardinality(v_week_ends), 0) >= v_max_redial then
      v_until := greatest(v_until, v_week_ends[v_max_redial] + interval '7 days');
    end if;
  end if;

  -- El mismo número en otro lead de la empresa (otra razón social con el mismo
  -- contador, o la misma persona en otra campaña).
  if v_phone is not null and p_organization_id is not null then
    select
      count(*) over () as total,
      attempt.ended_at,
      (attempt.bridged_at is not null or attempt.answered_at is not null or attempt.status = 'abandoned') as spoke
    into v_other
    from public.dial_attempts attempt
    join public.campaigns campaign on campaign.id = attempt.campaign_id
    where public.canonical_chile_phone(attempt.phone) = v_phone
      and attempt.ended_at is not null
      and attempt.ended_at > v_now - interval '7 days'
      and attempt.lead_id <> p_lead_id
      and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed')
      and campaign.organization_id = p_organization_id
    order by attempt.ended_at desc
    limit 1;

    if found then
      v_until := greatest(
        v_until,
        v_other.ended_at + make_interval(mins => public.dialer_backoff_minutes(v_ladder, v_other.total::integer, v_other.spoke))
      );
    end if;
  end if;

  return case when v_until > v_now then v_until end;
end;
$$;

-- Recalcula el lead y todos los de la empresa con el mismo teléfono. En orden
-- de id para que dos recálculos simultáneos no se bloqueen en cruz.
create or replace function public.dialer_refresh_retry_at(
  p_organization_id uuid,
  p_phone text,
  p_lead_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_phone text := public.canonical_chile_phone(p_phone);
  v_lead record;
  v_retry_at timestamptz;
  v_updated integer := 0;
begin
  for v_lead in
    select lead.id, lead.organization_id, lead.campaign_id, lead.phone, lead.managed_at, lead.dialer_retry_at
    from public.leads lead
    where lead.id = p_lead_id
    union
    select lead.id, lead.organization_id, lead.campaign_id, lead.phone, lead.managed_at, lead.dialer_retry_at
    from public.leads lead
    where v_phone is not null
      and p_organization_id is not null
      and lead.organization_id = p_organization_id
      and lead.phone is not null
      and public.canonical_chile_phone(lead.phone) = v_phone
    order by 1
  loop
    v_retry_at := public.dialer_compute_lead_retry_at(
      v_lead.id, v_lead.organization_id, v_lead.campaign_id, v_lead.phone, v_lead.managed_at
    );
    if v_retry_at is distinct from v_lead.dialer_retry_at then
      update public.leads set dialer_retry_at = v_retry_at where id = v_lead.id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Disparadores. Ninguno puede tumbar lo que los dispara: un intento que no se
-- registra como terminado quedaría «en vuelo» para siempre, y una ficha que no
-- se guarda es peor que una espera mal calculada.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_attempt_finished_refresh()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  begin
    perform public.dialer_refresh_retry_at(
      (select campaign.organization_id from public.campaigns campaign where campaign.id = new.campaign_id),
      new.phone,
      new.lead_id
    );
  exception when others then
    raise warning 'No se pudo recalcular la espera del lead % tras el intento %: %', new.lead_id, new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists dial_attempts_refresh_retry_on_insert on public.dial_attempts;
create trigger dial_attempts_refresh_retry_on_insert
  after insert on public.dial_attempts
  for each row
  when (new.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed'))
  execute function public.dialer_attempt_finished_refresh();

drop trigger if exists dial_attempts_refresh_retry_on_finish on public.dial_attempts;
create trigger dial_attempts_refresh_retry_on_finish
  after update of status on public.dial_attempts
  for each row
  when (
    new.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed')
    and old.status is distinct from new.status
  )
  execute function public.dialer_attempt_finished_refresh();

-- Al gestionar el lead, cambiarlo de campaña o de teléfono, o devolverlo a la
-- cola, su espera se recalcula en la misma fila.
create or replace function public.dialer_leads_recompute_retry_at()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if tg_op = 'UPDATE'
    and old.managed_at is not distinct from new.managed_at
    and old.campaign_id is not distinct from new.campaign_id
    and old.organization_id is not distinct from new.organization_id
    and old.phone is not distinct from new.phone
    and old.workflow_status is not distinct from new.workflow_status
    and old.assignment_status is not distinct from new.assignment_status then
    return new;
  end if;

  if new.campaign_id is null or new.phone is null or btrim(new.phone) = '' then
    new.dialer_retry_at := null;
    return new;
  end if;

  begin
    new.dialer_retry_at := public.dialer_compute_lead_retry_at(
      new.id, new.organization_id, new.campaign_id, new.phone, new.managed_at
    );
  exception when others then
    raise warning 'No se pudo calcular la espera del lead %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- El nombre empieza con «zz_» a propósito: los BEFORE se disparan en orden
-- alfabético y este tiene que correr después de leads_heredan_empresa y de
-- route_new_whatsapp_lead_to_queue, que fijan la empresa y la campaña.
drop trigger if exists zz_leads_espera_de_discado on public.leads;
create trigger zz_leads_espera_de_discado
  before insert or update of managed_at, campaign_id, organization_id, phone, workflow_status, assignment_status
  on public.leads
  for each row execute function public.dialer_leads_recompute_retry_at();

-- Agregar o levantar un teléfono de la lista de no llamar mueve a todos los
-- leads de la empresa con ese número.
create or replace function public.dialer_suppression_refresh_leads()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  begin
    perform public.dialer_refresh_retry_at(new.organization_id, new.phone, null);
    if tg_op = 'UPDATE'
      and (old.phone is distinct from new.phone or old.organization_id is distinct from new.organization_id) then
      perform public.dialer_refresh_retry_at(old.organization_id, old.phone, null);
    end if;
  exception when others then
    raise warning 'No se pudo recalcular la cola para el teléfono %: %', new.phone, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists dialer_phone_suppressions_refresh_leads on public.dialer_phone_suppressions;
create trigger dialer_phone_suppressions_refresh_leads
  after insert or update on public.dialer_phone_suppressions
  for each row execute function public.dialer_suppression_refresh_leads();

-- Si cambia la política de la campaña (escalones, tope semanal o total), las
-- esperas ya escritas se recalculan: subir el tope devuelve a la cola a los
-- que lo habían agotado. Solo toca leads con una espera vigente (recorrer la
-- campaña entera haría lento guardar la configuración); bajar el tope rige
-- para los demás desde su próximo intento.
create or replace function public.dialer_recompute_campaign_retry_at(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_updated integer;
begin
  with calculado as (
    select
      lead.id,
      public.dialer_compute_lead_retry_at(lead.id, lead.organization_id, lead.campaign_id, lead.phone, lead.managed_at) as retry_at
    from public.leads lead
    where lead.campaign_id = p_campaign_id
      and lead.dialer_retry_at is not null
    order by lead.id
  )
  update public.leads lead
  set dialer_retry_at = calculado.retry_at
  from calculado
  where lead.id = calculado.id
    and lead.dialer_retry_at is distinct from calculado.retry_at;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.dialer_config_recompute_retry_at()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  perform public.dialer_recompute_campaign_retry_at(new.campaign_id);
  return null;
end;
$$;

drop trigger if exists dialer_campaign_configs_recompute_retry on public.dialer_campaign_configs;
create trigger dialer_campaign_configs_recompute_retry
  after update of redial_backoff_minutes, max_redial_attempts, max_uncontacted_attempts
  on public.dialer_campaign_configs
  for each row
  when (
    old.redial_backoff_minutes is distinct from new.redial_backoff_minutes
    or old.max_redial_attempts is distinct from new.max_redial_attempts
    or old.max_uncontacted_attempts is distinct from new.max_uncontacted_attempts
  )
  execute function public.dialer_config_recompute_retry_at();

-- ---------------------------------------------------------------------------
-- Carga inicial: solo leads que el discador todavía puede tomar (pendientes o
-- agenda sin dueño), para no tocar la fecha de actualización de miles de
-- gestiones cerradas. Los cerrados se recalculan solos si vuelven a la cola.
-- ---------------------------------------------------------------------------
with afectados as (
  select distinct attempt.lead_id as id
  from public.dial_attempts attempt
  where attempt.ended_at is not null
  union
  select lead.id
  from public.dialer_phone_suppressions suppression
  join public.leads lead
    on lead.organization_id = suppression.organization_id
   and lead.phone is not null
   and public.canonical_chile_phone(lead.phone) = suppression.phone
  where suppression.lifted_at is null
  union
  select lead.id
  from public.dial_attempts attempt
  join public.campaigns campaign on campaign.id = attempt.campaign_id
  join public.leads lead
    on lead.organization_id = campaign.organization_id
   and lead.phone is not null
   and public.canonical_chile_phone(lead.phone) = public.canonical_chile_phone(attempt.phone)
  where attempt.ended_at > now() - interval '7 days'
), calculado as (
  select
    lead.id,
    public.dialer_compute_lead_retry_at(lead.id, lead.organization_id, lead.campaign_id, lead.phone, lead.managed_at) as retry_at
  from public.leads lead
  join afectados on afectados.id = lead.id
  where lead.campaign_id is not null
    and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception')
)
update public.leads lead
set dialer_retry_at = calculado.retry_at
from calculado
where lead.id = calculado.id
  and lead.dialer_retry_at is distinct from calculado.retry_at;

revoke all on function public.dialer_compute_lead_retry_at(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.dialer_refresh_retry_at(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.dialer_attempt_finished_refresh() from public, anon, authenticated;
revoke all on function public.dialer_leads_recompute_retry_at() from public, anon, authenticated;
revoke all on function public.dialer_suppression_refresh_leads() from public, anon, authenticated;
revoke all on function public.dialer_recompute_campaign_retry_at(uuid) from public, anon, authenticated;
revoke all on function public.dialer_config_recompute_retry_at() from public, anon, authenticated;
grant execute on function public.dialer_compute_lead_retry_at(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.dialer_refresh_retry_at(uuid, text, uuid) to service_role;
grant execute on function public.dialer_recompute_campaign_retry_at(uuid) to service_role;
