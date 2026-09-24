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
-- llamar (leads.dialer_retry_at). El claim lee esa columna con índices y, como
-- red, no marca un número que tuvo un intento hace menos que la espera mínima.
--
-- Reglas (política en dialer_campaign_configs, 20260924181000). Cada intento
-- terminado es 'real' (le sonó al cliente), 'tecnico' (no alcanzó a sonar) o
-- 'ignorado' (agenda cuyo ejecutivo no contestó): dialer_attempt_result_class.
--   * Ciclo: desde la última gestión humana (leads.managed_at) o desde que un
--     supervisor devolvió el lead a la cola (leads.dialer_cycle_started_at).
--     El ciclo reinicia los contadores, no la espera.
--   * Espera propia desde el último intento, aunque sea anterior al ciclo:
--     tras un contacto o abandono, el último escalón (24 h); tras un intento
--     real sin contacto, el escalón que toca (30 min, 2 h, 24 h); tras una falla
--     técnica, technical_retry_minutes duplicándose con cada falla seguida.
--     Un lead que vuelve a la cola sin agenda espera además el último escalón
--     desde su gestión: a quien acaba de hablar con un ejecutivo no se lo
--     vuelve a llamar en el día.
--   * Cupo semanal: máximo max_redial_attempts intentos reales en 7 días por
--     lead (dentro del ciclo) y por teléfono (todos los leads de la empresa).
--   * Tope: max_uncontacted_attempts intentos reales en el ciclo, o
--     max_technical_failures fallas técnicas seguidas, y el lead sale de la cola
--     (dialer_retry_at = 'infinity', dialer_hold_reason dice por qué) hasta una
--     gestión humana o hasta que un supervisor lo devuelva
--     (dialer_release_held_leads). Queda a la vista en dialer_held_leads.
--   * Por teléfono: la espera más larga que imponga cualquier intento real de
--     los últimos 7 días sobre el mismo número en otro lead de la empresa (24 h
--     si esa persona habló con alguien).
--   * Teléfono en la lista de no llamar: 'infinity' (o hasta que venza).
--   * Agenda (next_action_at): la hora la puso una persona. No le aplican los
--     cupos semanales ni la espera por intentos anteriores a la agenda; sí la
--     espera mínima entre llamadas al mismo número y la lista de no llamar.
--
-- Si un recálculo falla o choca con un lead bloqueado, el lead queda en
-- dialer_retry_recompute_queue y un cron lo reintenta cada minuto: nunca queda
-- un error escondido en un WARNING.

alter table public.leads
  add column if not exists dialer_retry_at timestamptz,
  add column if not exists dialer_hold_reason text,
  add column if not exists dialer_cycle_started_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_dialer_hold_reason_check') then
    alter table public.leads
      add constraint leads_dialer_hold_reason_check
      check (dialer_hold_reason is null or dialer_hold_reason in (
        'no_llamar', 'tope_sin_contacto', 'tope_fallas_tecnicas'
      ));
  end if;
end;
$$;

comment on column public.leads.dialer_retry_at is
  'Desde cuándo el discador puede volver a marcar este lead (espera por lead y por teléfono, cupo semanal, tope o lista de no llamar). null = sin espera; infinity = fuera de la cola (ver dialer_hold_reason).';
comment on column public.leads.dialer_hold_reason is
  'Por qué el lead está fuera de la cola del discador: no_llamar, tope_sin_contacto o tope_fallas_tecnicas. null = no está retenido.';
comment on column public.leads.dialer_cycle_started_at is
  'Cuándo un supervisor devolvió el lead a la cola: reinicia los contadores de intentos, como una gestión humana.';

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

create index if not exists leads_dialer_held_idx
  on public.leads (campaign_id, dialer_hold_reason)
  where dialer_hold_reason is not null;

-- Historial reciente por teléfono, para la espera entre leads distintos y la
-- barrera del claim.
create index if not exists dial_attempts_phone_history_idx
  on public.dial_attempts (public.canonical_chile_phone(phone), ended_at desc)
  where ended_at is not null;

-- Intentos terminados por campaña y hora, para el cortacircuitos.
create index if not exists dial_attempts_campaign_ended_idx
  on public.dial_attempts (campaign_id, ended_at desc)
  where ended_at is not null;

-- ---------------------------------------------------------------------------
-- Colas de recálculo. Sin claves foráneas a propósito: un error al encolar no
-- puede tumbar a quien encola; el cron ignora leads que ya no existen.
-- ---------------------------------------------------------------------------
create table if not exists public.dialer_retry_recompute_queue (
  lead_id uuid primary key,
  reason text not null,
  last_error text,
  attempts integer not null default 0,
  requested_at timestamptz not null default now()
);

create table if not exists public.dialer_retry_recompute_campaigns (
  campaign_id uuid primary key,
  -- false = solo leads con una espera vigente (cambio de política); true = toda
  -- la campaña (después de una carga masiva que se saltó los disparadores).
  include_all boolean not null default false,
  after_lead_id uuid,
  requested_at timestamptz not null default now()
);

comment on table public.dialer_retry_recompute_queue is
  'Leads cuya espera de discado hay que recalcular: el disparador falló (last_error) o el lead estaba bloqueado. Lo vacía el cron dialer-retry-recompute cada minuto.';
comment on table public.dialer_retry_recompute_campaigns is
  'Campañas cuyas esperas hay que recalcular por lotes (cambio de política o carga masiva). Lo procesa el cron dialer-retry-recompute.';

alter table public.dialer_retry_recompute_queue enable row level security;
alter table public.dialer_retry_recompute_campaigns enable row level security;
revoke all on table public.dialer_retry_recompute_queue from anon, authenticated;
revoke all on table public.dialer_retry_recompute_campaigns from anon, authenticated;

create or replace function public.dialer_enqueue_retry_recompute(p_lead_id uuid, p_reason text, p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_lead_id is null then
    return;
  end if;
  insert into public.dialer_retry_recompute_queue (lead_id, reason, last_error)
  values (p_lead_id, p_reason, p_error)
  on conflict (lead_id) do update
    set reason = excluded.reason,
        last_error = coalesce(excluded.last_error, public.dialer_retry_recompute_queue.last_error);
exception when others then
  raise warning 'No se pudo encolar el recálculo del lead %: %', p_lead_id, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- El cálculo. Lee la fuente de verdad (dial_attempts, la lista de no llamar y
-- la configuración); no guarda contadores que se puedan desfasar.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_compute_lead_retry(
  p_lead_id uuid,
  p_organization_id uuid,
  p_campaign_id uuid,
  p_phone text,
  p_managed_at timestamptz,
  p_cycle_started_at timestamptz,
  p_next_action_at timestamptz,
  out retry_at timestamptz,
  out hold_reason text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_now timestamptz := now();
  v_phone text := public.canonical_chile_phone(p_phone);
  v_ladder integer[];
  v_first integer;
  v_last_step integer;
  v_max_redial integer;
  v_cap integer;
  v_tech_minutes integer;
  v_tech_cap integer;
  v_cycle_start timestamptz := greatest(
    coalesce(p_managed_at, '-infinity'::timestamptz),
    coalesce(p_cycle_started_at, '-infinity'::timestamptz)
  );
  v_agenda boolean := p_next_action_at is not null;
  v_until timestamptz := '-infinity'::timestamptz;
  v_suppressed_until timestamptz;
  v_attempt record;
  v_class text;
  v_spoke boolean;
  v_in_cycle boolean;
  v_has_last boolean := false;
  v_last_ended timestamptz;
  v_last_class text;
  v_last_spoke boolean;
  v_last_in_cycle boolean;
  v_real integer := 0;
  v_streak integer := 0;
  v_streak_open boolean := true;
  v_week timestamptz[] := '{}';
  v_phone_week timestamptz[];
  v_phone_gap timestamptz;
  v_step integer;
begin
  if p_lead_id is null or p_campaign_id is null then
    return;
  end if;

  select config.redial_backoff_minutes, config.max_redial_attempts, config.max_uncontacted_attempts,
         config.technical_retry_minutes, config.max_technical_failures
  into v_ladder, v_max_redial, v_cap, v_tech_minutes, v_tech_cap
  from public.dialer_campaign_configs config
  where config.campaign_id = p_campaign_id;
  if not found then
    -- Sin configuración, los mismos valores por defecto de la tabla.
    v_cap := 8;
    v_tech_cap := 10;
  end if;
  v_ladder := coalesce(nullif(v_ladder, '{}'::integer[]), '{30,120,1440}'::integer[]);
  v_first := v_ladder[1];
  v_last_step := v_ladder[cardinality(v_ladder)];
  v_max_redial := coalesce(v_max_redial, 4);
  v_tech_minutes := coalesce(v_tech_minutes, 10);

  -- Lista de no llamar: gana sobre todo lo demás.
  if v_phone is not null and p_organization_id is not null then
    v_suppressed_until := public.dialer_phone_suppressed_until(p_organization_id, p_campaign_id, v_phone);
    if v_suppressed_until = 'infinity'::timestamptz then
      retry_at := v_suppressed_until;
      hold_reason := 'no_llamar';
      return;
    end if;
    v_until := greatest(v_until, coalesce(v_suppressed_until, '-infinity'::timestamptz));
  end if;

  -- Intentos del lead, del más nuevo al más viejo (un lead tiene pocos).
  for v_attempt in
    select attempt.status, attempt.attempt_kind, attempt.originated_at, attempt.answered_at,
           attempt.bridged_at, attempt.ended_at, attempt.hangup_cause
    from public.dial_attempts attempt
    where attempt.lead_id = p_lead_id
      and attempt.ended_at is not null
      and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed')
    order by attempt.ended_at desc
  loop
    v_class := public.dialer_attempt_result_class(
      v_attempt.status, v_attempt.attempt_kind, v_attempt.originated_at, v_attempt.hangup_cause
    );
    continue when v_class is null or v_class = 'ignorado';

    v_spoke := v_class = 'real' and (
      v_attempt.status = 'abandoned'
      or v_attempt.bridged_at is not null
      or (v_attempt.answered_at is not null and v_attempt.status <> 'voicemail')
    );
    -- El intento que originó la gestión (puente antes de managed_at, aunque
    -- terminara después) es el contacto, no un intento del ciclo nuevo.
    v_in_cycle := v_attempt.ended_at > v_cycle_start
      and not (v_attempt.bridged_at is not null and v_attempt.bridged_at <= v_cycle_start);

    if not v_has_last then
      v_has_last := true;
      v_last_ended := v_attempt.ended_at;
      v_last_class := v_class;
      v_last_spoke := v_spoke;
      v_last_in_cycle := v_in_cycle;
    end if;

    if not v_in_cycle then
      v_streak_open := false;
      continue;
    end if;

    if v_class = 'tecnico' then
      if v_streak_open then
        v_streak := v_streak + 1;
      end if;
    else
      v_streak_open := false;
      v_real := v_real + 1;
      if v_attempt.ended_at > v_now - interval '7 days' then
        v_week := v_week || v_attempt.ended_at;
      end if;
    end if;
  end loop;

  if v_cap is not null and v_real >= v_cap then
    retry_at := 'infinity'::timestamptz;
    hold_reason := 'tope_sin_contacto';
    return;
  end if;
  if v_tech_cap is not null and v_streak >= v_tech_cap then
    retry_at := 'infinity'::timestamptz;
    hold_reason := 'tope_fallas_tecnicas';
    return;
  end if;

  -- Espera propia desde el último intento. En una agenda, los intentos previos
  -- a la agenda no la retrasan: la hora la acordó una persona.
  if v_has_last and (v_last_in_cycle or not v_agenda) then
    v_step := case
      when v_last_class = 'tecnico' then
        least(v_tech_minutes * power(2, least(greatest(v_streak, 1) - 1, 16)), v_last_step)::integer
      when v_last_spoke then v_last_step
      when v_last_in_cycle then public.dialer_backoff_minutes(v_ladder, v_real)
      else v_first
    end;
    v_until := greatest(v_until, v_last_ended + make_interval(mins => v_step));
  end if;

  if not v_agenda then
    -- Volvió a la cola después de hablar con un ejecutivo: no en el mismo día.
    if p_managed_at is not null then
      v_until := greatest(v_until, p_managed_at + make_interval(mins => v_last_step));
    end if;
    -- Cupo semanal del lead (v_week va del más nuevo al más viejo).
    if v_max_redial >= 1 and cardinality(v_week) >= v_max_redial then
      v_until := greatest(v_until, v_week[v_max_redial] + interval '7 days');
    end if;
  end if;

  -- El mismo número en la empresa: otra razón social con el mismo contador, o
  -- la misma persona en otra campaña. Se toma la espera más larga, no solo la
  -- del último intento, y el cupo semanal vale también por número.
  if v_phone is not null and p_organization_id is not null then
    select
      array_agg(attempt.ended_at order by attempt.ended_at desc) filter (where kind.clase = 'real'),
      max(attempt.ended_at + make_interval(mins => case when kind.spoke and not v_agenda then v_last_step else v_first end))
        filter (where kind.clase = 'real' and attempt.lead_id <> p_lead_id)
    into v_phone_week, v_phone_gap
    from public.dial_attempts attempt
    join public.campaigns campaign
      on campaign.id = attempt.campaign_id
     and campaign.organization_id = p_organization_id
    cross join lateral (
      select
        public.dialer_attempt_result_class(attempt.status, attempt.attempt_kind, attempt.originated_at, attempt.hangup_cause) as clase,
        (attempt.status = 'abandoned'
          or attempt.bridged_at is not null
          or (attempt.answered_at is not null and attempt.status <> 'voicemail')) as spoke
    ) kind
    where public.canonical_chile_phone(attempt.phone) = v_phone
      and attempt.ended_at is not null
      and attempt.ended_at > v_now - interval '7 days'
      and attempt.status in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed');

    v_until := greatest(v_until, coalesce(v_phone_gap, '-infinity'::timestamptz));
    if not v_agenda and v_max_redial >= 1 and coalesce(cardinality(v_phone_week), 0) >= v_max_redial then
      v_until := greatest(v_until, v_phone_week[v_max_redial] + interval '7 days');
    end if;
  end if;

  if v_until > v_now then
    retry_at := v_until;
    if v_suppressed_until is not null and v_suppressed_until >= v_until then
      hold_reason := 'no_llamar';
    end if;
  end if;
end;
$$;

-- Recalcula un lead y lo escribe. No espera a un lead bloqueado (un ejecutivo
-- guardándolo, otro recálculo): lo deja en la cola del cron. Así dos
-- recálculos o un recálculo y una tipificación no pueden bloquearse en cruz.
create or replace function public.dialer_refresh_lead_retry_at(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead record;
  v_calc record;
begin
  select lead.id, lead.organization_id, lead.campaign_id, lead.phone, lead.managed_at,
         lead.dialer_cycle_started_at, lead.next_action_at, lead.dialer_retry_at, lead.dialer_hold_reason
  into v_lead
  from public.leads lead
  where lead.id = p_lead_id
  for update skip locked;

  if not found then
    if exists (select 1 from public.leads lead where lead.id = p_lead_id) then
      perform public.dialer_enqueue_retry_recompute(p_lead_id, 'bloqueo');
      return false;
    end if;
    return true;
  end if;

  if v_lead.campaign_id is null or v_lead.phone is null or btrim(v_lead.phone) = '' then
    select null::timestamptz as retry_at, null::text as hold_reason into v_calc;
  else
    select * into v_calc
    from public.dialer_compute_lead_retry(
      v_lead.id, v_lead.organization_id, v_lead.campaign_id, v_lead.phone,
      v_lead.managed_at, v_lead.dialer_cycle_started_at, v_lead.next_action_at
    );
  end if;

  if v_calc.retry_at is distinct from v_lead.dialer_retry_at
    or v_calc.hold_reason is distinct from v_lead.dialer_hold_reason then
    update public.leads
    set dialer_retry_at = v_calc.retry_at,
        dialer_hold_reason = v_calc.hold_reason
    where id = v_lead.id;
  end if;
  return true;
end;
$$;

-- Recalcula el lead y todos los de la empresa con el mismo teléfono.
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
  v_lead_id uuid;
  v_done integer := 0;
begin
  for v_lead_id in
    select lead.id
    from public.leads lead
    where lead.id = p_lead_id
    union
    select lead.id
    from public.leads lead
    where v_phone is not null
      and p_organization_id is not null
      and lead.organization_id = p_organization_id
      and lead.phone is not null
      and public.canonical_chile_phone(lead.phone) = v_phone
    order by 1
  loop
    if public.dialer_refresh_lead_retry_at(v_lead_id) then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Disparadores. Ninguno puede tumbar lo que los dispara (un intento que no se
-- registra como terminado quedaría «en vuelo» para siempre; una ficha que no
-- se guarda es peor que una espera mal calculada), pero ninguno se calla: el
-- lead queda en la cola del cron con el error.
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
    perform public.dialer_enqueue_retry_recompute(new.lead_id, 'error', sqlerrm);
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

-- Al gestionar el lead, cambiarlo de campaña o de teléfono, agendarlo,
-- devolverlo a la cola o reiniciar su ciclo, su espera se recalcula en la
-- misma fila. Una carga o un reproceso masivo puede saltarse este cálculo con
-- set_config('atlas.skip_retry_recompute', 'on', true) y pedir después el
-- recálculo por lotes con dialer_request_campaign_retry_recompute.
create or replace function public.dialer_leads_recompute_retry()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_calc record;
begin
  if tg_op = 'UPDATE'
    and old.managed_at is not distinct from new.managed_at
    and old.campaign_id is not distinct from new.campaign_id
    and old.organization_id is not distinct from new.organization_id
    and old.phone is not distinct from new.phone
    and old.workflow_status is not distinct from new.workflow_status
    and old.assignment_status is not distinct from new.assignment_status
    and old.next_action_at is not distinct from new.next_action_at
    and old.dialer_cycle_started_at is not distinct from new.dialer_cycle_started_at then
    return new;
  end if;

  if coalesce(current_setting('atlas.skip_retry_recompute', true), '') = 'on' then
    return new;
  end if;

  if new.campaign_id is null or new.phone is null or btrim(new.phone) = '' then
    new.dialer_retry_at := null;
    new.dialer_hold_reason := null;
    return new;
  end if;

  begin
    select * into v_calc
    from public.dialer_compute_lead_retry(
      new.id, new.organization_id, new.campaign_id, new.phone,
      new.managed_at, new.dialer_cycle_started_at, new.next_action_at
    );
    new.dialer_retry_at := v_calc.retry_at;
    new.dialer_hold_reason := v_calc.hold_reason;
  exception when others then
    raise warning 'No se pudo calcular la espera del lead %: %', new.id, sqlerrm;
    perform public.dialer_enqueue_retry_recompute(new.id, 'error', sqlerrm);
  end;
  return new;
end;
$$;

-- El nombre empieza con «zz_» a propósito: los BEFORE se disparan en orden
-- alfabético y este tiene que correr después de leads_heredan_empresa y de
-- route_new_whatsapp_lead_to_queue, que fijan la empresa y la campaña.
drop trigger if exists zz_leads_espera_de_discado on public.leads;
create trigger zz_leads_espera_de_discado
  before insert or update of managed_at, campaign_id, organization_id, phone, workflow_status,
    assignment_status, next_action_at, dialer_cycle_started_at
  on public.leads
  for each row execute function public.dialer_leads_recompute_retry();

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
    -- Los leads de ese número quedan en la cola del cron.
    insert into public.dialer_retry_recompute_queue (lead_id, reason, last_error)
    select lead.id, 'error', sqlerrm
    from public.leads lead
    where lead.organization_id = new.organization_id
      and lead.phone is not null
      and public.canonical_chile_phone(lead.phone) = new.phone
    on conflict (lead_id) do update set reason = excluded.reason, last_error = excluded.last_error;
  end;
  return null;
end;
$$;

drop trigger if exists dialer_phone_suppressions_refresh_leads on public.dialer_phone_suppressions;
create trigger dialer_phone_suppressions_refresh_leads
  after insert or update on public.dialer_phone_suppressions
  for each row execute function public.dialer_suppression_refresh_leads();

-- ---------------------------------------------------------------------------
-- Cambio de política (escalones, cupos o topes): no se recalcula en la misma
-- petición (con decenas de miles de esperas vigentes superaría el límite de
-- 8 s de la pantalla); se pide y el cron la procesa por lotes. Subir el tope
-- devuelve a la cola a los que lo habían agotado. Bajarlo rige para los leads
-- sin espera desde su próximo intento.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_request_campaign_retry_recompute(
  p_campaign_id uuid,
  p_include_all boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  insert into public.dialer_retry_recompute_campaigns (campaign_id, include_all, after_lead_id, requested_at)
  values (p_campaign_id, coalesce(p_include_all, false), null, now())
  on conflict (campaign_id) do update
    set include_all = public.dialer_retry_recompute_campaigns.include_all or excluded.include_all,
        after_lead_id = null,
        requested_at = excluded.requested_at;
end;
$$;

create or replace function public.dialer_config_request_recompute()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  begin
    perform public.dialer_request_campaign_retry_recompute(new.campaign_id, false);
  exception when others then
    raise warning 'No se pudo pedir el recálculo de la campaña %: %', new.campaign_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists dialer_campaign_configs_recompute_retry on public.dialer_campaign_configs;
create trigger dialer_campaign_configs_recompute_retry
  after update of redial_backoff_minutes, max_redial_attempts, max_uncontacted_attempts,
    technical_retry_minutes, max_technical_failures
  on public.dialer_campaign_configs
  for each row
  when (
    old.redial_backoff_minutes is distinct from new.redial_backoff_minutes
    or old.max_redial_attempts is distinct from new.max_redial_attempts
    or old.max_uncontacted_attempts is distinct from new.max_uncontacted_attempts
    or old.technical_retry_minutes is distinct from new.technical_retry_minutes
    or old.max_technical_failures is distinct from new.max_technical_failures
  )
  execute function public.dialer_config_request_recompute();

-- El cron: primero los leads sueltos (errores y bloqueos), después las
-- campañas por lotes ordenados por id. Cada lead en su propio bloque: uno que
-- falla suma un intento y sigue en la cola, no detiene al resto.
create or replace function public.dialer_process_retry_recompute(p_budget integer default 5000)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_budget integer := greatest(coalesce(p_budget, 5000), 1);
  v_done integer := 0;
  v_item record;
  v_request record;
  v_lead_id uuid;
  v_last uuid;
  v_seen integer;
begin
  for v_item in
    select queue.lead_id
    from public.dialer_retry_recompute_queue queue
    where queue.attempts < 20
    order by queue.requested_at
    limit v_budget
  loop
    begin
      if public.dialer_refresh_lead_retry_at(v_item.lead_id) then
        delete from public.dialer_retry_recompute_queue where lead_id = v_item.lead_id;
      else
        update public.dialer_retry_recompute_queue
        set attempts = attempts + 1
        where lead_id = v_item.lead_id;
      end if;
    exception when others then
      update public.dialer_retry_recompute_queue
      set attempts = attempts + 1, last_error = sqlerrm
      where lead_id = v_item.lead_id;
    end;
    v_done := v_done + 1;
  end loop;

  for v_request in
    select request.*
    from public.dialer_retry_recompute_campaigns request
    order by request.requested_at
  loop
    exit when v_done >= v_budget;
    v_seen := 0;
    v_last := null;
    for v_lead_id in
      select lead.id
      from public.leads lead
      where lead.campaign_id = v_request.campaign_id
        and (v_request.after_lead_id is null or lead.id > v_request.after_lead_id)
        and (v_request.include_all or lead.dialer_retry_at > now())
      order by lead.id
      limit v_budget - v_done
    loop
      begin
        perform public.dialer_refresh_lead_retry_at(v_lead_id);
      exception when others then
        perform public.dialer_enqueue_retry_recompute(v_lead_id, 'error', sqlerrm);
      end;
      v_last := v_lead_id;
      v_seen := v_seen + 1;
      v_done := v_done + 1;
    end loop;

    if v_seen < v_budget - (v_done - v_seen) then
      -- Terminó la campaña (salvo que la hayan vuelto a pedir mientras tanto).
      delete from public.dialer_retry_recompute_campaigns
      where campaign_id = v_request.campaign_id
        and requested_at = v_request.requested_at;
    else
      update public.dialer_retry_recompute_campaigns
      set after_lead_id = v_last
      where campaign_id = v_request.campaign_id
        and requested_at = v_request.requested_at;
    end if;
  end loop;

  return v_done;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'dialer-retry-recompute',
      '* * * * *',
      'select public.dialer_process_retry_recompute()'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Los retenidos a la vista del supervisor, y la forma de devolverlos.
-- ---------------------------------------------------------------------------
create or replace view public.dialer_held_leads
with (security_invoker = true)
as
select
  lead.id as lead_id,
  lead.organization_id,
  lead.campaign_id,
  lead.full_name,
  lead.rut,
  lead.phone,
  lead.dialer_hold_reason,
  lead.dialer_retry_at,
  lead.managed_at,
  lead.dialer_cycle_started_at,
  lead.tipificacion_actual
from public.leads lead
where lead.dialer_hold_reason is not null;

comment on view public.dialer_held_leads is
  'Leads fuera de la cola del discador y por qué. Respeta la seguridad por fila de leads.';

revoke all on public.dialer_held_leads from anon;
grant select on public.dialer_held_leads to authenticated, service_role;

-- Devuelve a la cola los leads que agotaron su tope (no los de la lista de no
-- llamar: esos se liberan levantando la supresión). Reinicia su ciclo; el
-- recálculo lo hace el cron y, mientras tanto, esperan unos minutos para que
-- un reproceso grande no salga de golpe sin sus esperas por teléfono.
create or replace function public.dialer_release_held_leads(
  p_campaign_id uuid,
  p_lead_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_organization_id uuid := public.org_of_campaign(p_campaign_id);
  v_role public.app_role := public.current_role_name();
  v_released integer;
begin
  if v_organization_id is null then
    raise exception 'La campaña no existe' using errcode = 'P0002';
  end if;
  -- El motor (sin usuario) puede; una persona, solo en su empresa.
  if (select auth.uid()) is not null then
    perform public.assert_org_access(v_organization_id);
    if not public.is_platform_owner()
      and v_role is distinct from 'admin'::public.app_role
      and not (
        v_role = 'supervisor'::public.app_role
        and exists (select 1 from public.get_report_scope_campaigns() scope where scope.id = p_campaign_id)
      ) then
      raise exception 'Solo un admin o el supervisor de la campaña puede devolver leads a la cola.'
        using errcode = '42501';
    end if;
  end if;

  perform set_config('atlas.skip_retry_recompute', 'on', true);
  with liberados as (
    update public.leads lead
    set dialer_cycle_started_at = now(),
        dialer_hold_reason = null,
        dialer_retry_at = now() + interval '5 minutes'
    where lead.campaign_id = p_campaign_id
      and lead.dialer_hold_reason in ('tope_sin_contacto', 'tope_fallas_tecnicas')
      and (p_lead_ids is null or lead.id = any (p_lead_ids))
    returning lead.id
  )
  insert into public.dialer_retry_recompute_queue (lead_id, reason)
  select liberados.id, 'devuelto'
  from liberados
  on conflict (lead_id) do update set reason = excluded.reason;
  get diagnostics v_released = row_count;
  perform set_config('atlas.skip_retry_recompute', 'off', true);
  return v_released;
end;
$$;

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
  select lead.id, calc.retry_at, calc.hold_reason
  from public.leads lead
  join afectados on afectados.id = lead.id
  cross join lateral public.dialer_compute_lead_retry(
    lead.id, lead.organization_id, lead.campaign_id, lead.phone,
    lead.managed_at, lead.dialer_cycle_started_at, lead.next_action_at
  ) calc
  where lead.campaign_id is not null
    and lead.phone is not null
    and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception')
)
update public.leads lead
set dialer_retry_at = calculado.retry_at,
    dialer_hold_reason = calculado.hold_reason
from calculado
where lead.id = calculado.id
  and (lead.dialer_retry_at is distinct from calculado.retry_at
    or lead.dialer_hold_reason is distinct from calculado.hold_reason);

revoke all on function public.dialer_enqueue_retry_recompute(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dialer_compute_lead_retry(uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.dialer_refresh_lead_retry_at(uuid) from public, anon, authenticated;
revoke all on function public.dialer_refresh_retry_at(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.dialer_attempt_finished_refresh() from public, anon, authenticated;
revoke all on function public.dialer_leads_recompute_retry() from public, anon, authenticated;
revoke all on function public.dialer_suppression_refresh_leads() from public, anon, authenticated;
revoke all on function public.dialer_request_campaign_retry_recompute(uuid, boolean) from public, anon, authenticated;
revoke all on function public.dialer_config_request_recompute() from public, anon, authenticated;
revoke all on function public.dialer_process_retry_recompute(integer) from public, anon, authenticated;
revoke all on function public.dialer_release_held_leads(uuid, uuid[]) from public, anon;
grant execute on function public.dialer_compute_lead_retry(uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.dialer_refresh_lead_retry_at(uuid) to service_role;
grant execute on function public.dialer_refresh_retry_at(uuid, text, uuid) to service_role;
grant execute on function public.dialer_request_campaign_retry_recompute(uuid, boolean) to service_role;
grant execute on function public.dialer_process_retry_recompute(integer) to service_role;
grant execute on function public.dialer_release_held_leads(uuid, uuid[]) to authenticated, service_role;
