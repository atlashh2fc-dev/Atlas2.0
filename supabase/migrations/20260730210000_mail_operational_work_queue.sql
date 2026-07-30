-- La campaña CRM y la campaña Mail no son la misma entidad. Una campaña CRM
-- puede recibir resultados de más de una campaña Mail; por eso
-- `lead_mail_status(campaign_id, lead_id)` no puede ser la fuente de una
-- bandeja o reporte por campaña Mail. Esta es la proyección por work item
-- correcta: una fila por (mail_campaign_id, lead_id).

begin;

create table if not exists public.mail_campaign_lead_status (
  mail_campaign_id uuid not null references public.mail_campaigns(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  email_normalized text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_batch_id uuid references public.mail_result_batches(id) on delete set null,
  sent boolean not null default false,
  delivered boolean not null default false,
  bounced boolean not null default false,
  opened boolean not null default false,
  clicked boolean not null default false,
  complained boolean not null default false,
  unsubscribed boolean not null default false,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  bounced_count integer not null default 0,
  opened_count integer not null default 0,
  clicked_count integer not null default 0,
  complained_count integer not null default 0,
  unsubscribed_count integer not null default 0,
  priority_bucket text not null default 'p5_other',
  priority_rank integer not null default 70,
  priority_reason text,
  updated_at timestamptz not null default now(),
  primary key (mail_campaign_id, lead_id)
);

create index if not exists mail_campaign_lead_status_hot_queue_idx
  on public.mail_campaign_lead_status (mail_campaign_id, priority_rank, last_seen_at desc, lead_id)
  where opened or clicked;

create index if not exists mail_campaign_lead_status_campaign_hot_queue_idx
  on public.mail_campaign_lead_status (campaign_id, priority_rank, last_seen_at desc, lead_id)
  where opened or clicked;

-- Impide que una importación se cuele entre el backfill y la creación del
-- trigger. La tabla tiene un volumen acotado y el bloqueo dura una sola
-- migración transaccional; los importadores se reanudan al hacer commit.
lock table public.mail_result_contacts in share row exclusive mode;

-- Backfill únicamente desde lotes que contienen una campaña Mail explícita.
-- Los lotes legacy sin `mail_campaign_id` no tienen una atribución fiable si
-- la campaña CRM posee más de una campaña Mail: inventarla reintroduciría el
-- error que esta migración corrige.
with aggregate_events as (
  select
    b.mail_campaign_id,
    b.campaign_id,
    r.lead_id,
    min(r.created_at) as first_seen_at,
    max(r.created_at) as last_seen_at,
    max(r.email_normalized) filter (where r.email_normalized is not null) as email_normalized,
    bool_or(r.sent) as sent,
    bool_or(r.delivered) as delivered,
    bool_or(r.bounced) as bounced,
    bool_or(r.opened) as opened,
    bool_or(r.clicked) as clicked,
    bool_or(r.complained) as complained,
    bool_or(r.unsubscribed) as unsubscribed,
    count(*) filter (where r.sent)::integer as sent_count,
    count(*) filter (where r.delivered)::integer as delivered_count,
    count(*) filter (where r.bounced)::integer as bounced_count,
    count(*) filter (where r.opened)::integer as opened_count,
    count(*) filter (where r.clicked)::integer as clicked_count,
    count(*) filter (where r.complained)::integer as complained_count,
    count(*) filter (where r.unsubscribed)::integer as unsubscribed_count
  from public.mail_result_contacts r
  join public.mail_result_batches b on b.id = r.batch_id
  join public.leads l on l.id = r.lead_id and l.campaign_id = b.campaign_id
  where r.lead_id is not null
    and b.mail_campaign_id is not null
  group by b.mail_campaign_id, b.campaign_id, r.lead_id
),
last_events as (
  select distinct on (b.mail_campaign_id, r.lead_id)
    b.mail_campaign_id,
    r.lead_id,
    r.batch_id
  from public.mail_result_contacts r
  join public.mail_result_batches b on b.id = r.batch_id
  join public.leads l on l.id = r.lead_id and l.campaign_id = b.campaign_id
  where r.lead_id is not null
    and b.mail_campaign_id is not null
  order by b.mail_campaign_id, r.lead_id, r.created_at desc, r.id desc
)
insert into public.mail_campaign_lead_status (
  mail_campaign_id, campaign_id, lead_id, email_normalized, first_seen_at,
  last_seen_at, last_batch_id, sent, delivered, bounced, opened, clicked,
  complained, unsubscribed, sent_count, delivered_count, bounced_count,
  opened_count, clicked_count, complained_count, unsubscribed_count,
  priority_bucket, priority_rank, priority_reason
)
select
  a.mail_campaign_id,
  a.campaign_id,
  a.lead_id,
  a.email_normalized,
  a.first_seen_at,
  a.last_seen_at,
  e.batch_id,
  a.sent,
  a.delivered,
  a.bounced,
  a.opened,
  a.clicked,
  a.complained,
  a.unsubscribed,
  a.sent_count,
  a.delivered_count,
  a.bounced_count,
  a.opened_count,
  a.clicked_count,
  a.complained_count,
  a.unsubscribed_count,
  public.atlas_mail_priority_bucket(a.clicked, a.opened, a.bounced, a.complained, a.unsubscribed, a.delivered, a.sent),
  public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(a.clicked, a.opened, a.bounced, a.complained, a.unsubscribed, a.delivered, a.sent)),
  public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(a.clicked, a.opened, a.bounced, a.complained, a.unsubscribed, a.delivered, a.sent))
from aggregate_events a
join last_events e on e.mail_campaign_id = a.mail_campaign_id and e.lead_id = a.lead_id
on conflict (mail_campaign_id, lead_id) do update set
  campaign_id = excluded.campaign_id,
  email_normalized = coalesce(excluded.email_normalized, public.mail_campaign_lead_status.email_normalized),
  first_seen_at = excluded.first_seen_at,
  last_seen_at = excluded.last_seen_at,
  last_batch_id = excluded.last_batch_id,
  sent = excluded.sent,
  delivered = excluded.delivered,
  bounced = excluded.bounced,
  opened = excluded.opened,
  clicked = excluded.clicked,
  complained = excluded.complained,
  unsubscribed = excluded.unsubscribed,
  sent_count = excluded.sent_count,
  delivered_count = excluded.delivered_count,
  bounced_count = excluded.bounced_count,
  opened_count = excluded.opened_count,
  clicked_count = excluded.clicked_count,
  complained_count = excluded.complained_count,
  unsubscribed_count = excluded.unsubscribed_count,
  priority_bucket = excluded.priority_bucket,
  priority_rank = excluded.priority_rank,
  priority_reason = excluded.priority_reason,
  updated_at = now();

-- Cada importación inserta contactos antes de devolver el resultado. El
-- trigger es el único actualizador de la proyección nueva, por lo que cubre
-- importaciones Atlas Lead y cualquier importador futuro que use la tabla.
create or replace function public.project_mail_campaign_lead_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mail_campaign_id uuid;
  v_campaign_id uuid;
begin
  if new.lead_id is null then
    return new;
  end if;

  select b.mail_campaign_id, b.campaign_id
  into v_mail_campaign_id, v_campaign_id
  from public.mail_result_batches b
  where b.id = new.batch_id;

  -- No se adivina la campaña Mail para un lote legacy sin identificador.
  if v_mail_campaign_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.leads l
    where l.id = new.lead_id
      and l.campaign_id = v_campaign_id
  ) then
    raise exception 'El lead % no pertenece a la campaña CRM del lote mail %.', new.lead_id, new.batch_id;
  end if;

  insert into public.mail_campaign_lead_status (
    mail_campaign_id, campaign_id, lead_id, email_normalized, first_seen_at,
    last_seen_at, last_batch_id, sent, delivered, bounced, opened, clicked,
    complained, unsubscribed, sent_count, delivered_count, bounced_count,
    opened_count, clicked_count, complained_count, unsubscribed_count,
    priority_bucket, priority_rank, priority_reason
  )
  values (
    v_mail_campaign_id, v_campaign_id, new.lead_id, new.email_normalized,
    new.created_at, new.created_at, new.batch_id, new.sent, new.delivered,
    new.bounced, new.opened, new.clicked, new.complained, new.unsubscribed,
    case when new.sent then 1 else 0 end,
    case when new.delivered then 1 else 0 end,
    case when new.bounced then 1 else 0 end,
    case when new.opened then 1 else 0 end,
    case when new.clicked then 1 else 0 end,
    case when new.complained then 1 else 0 end,
    case when new.unsubscribed then 1 else 0 end,
    public.atlas_mail_priority_bucket(new.clicked, new.opened, new.bounced, new.complained, new.unsubscribed, new.delivered, new.sent),
    public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(new.clicked, new.opened, new.bounced, new.complained, new.unsubscribed, new.delivered, new.sent)),
    public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(new.clicked, new.opened, new.bounced, new.complained, new.unsubscribed, new.delivered, new.sent))
  )
  on conflict (mail_campaign_id, lead_id) do update set
    campaign_id = excluded.campaign_id,
    email_normalized = coalesce(excluded.email_normalized, public.mail_campaign_lead_status.email_normalized),
    first_seen_at = least(public.mail_campaign_lead_status.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.mail_campaign_lead_status.last_seen_at, excluded.last_seen_at),
    last_batch_id = case
      when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at then excluded.last_batch_id
      else public.mail_campaign_lead_status.last_batch_id
    end,
    sent = public.mail_campaign_lead_status.sent or excluded.sent,
    delivered = public.mail_campaign_lead_status.delivered or excluded.delivered,
    bounced = public.mail_campaign_lead_status.bounced or excluded.bounced,
    opened = public.mail_campaign_lead_status.opened or excluded.opened,
    clicked = public.mail_campaign_lead_status.clicked or excluded.clicked,
    complained = public.mail_campaign_lead_status.complained or excluded.complained,
    unsubscribed = public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
    sent_count = public.mail_campaign_lead_status.sent_count + excluded.sent_count,
    delivered_count = public.mail_campaign_lead_status.delivered_count + excluded.delivered_count,
    bounced_count = public.mail_campaign_lead_status.bounced_count + excluded.bounced_count,
    opened_count = public.mail_campaign_lead_status.opened_count + excluded.opened_count,
    clicked_count = public.mail_campaign_lead_status.clicked_count + excluded.clicked_count,
    complained_count = public.mail_campaign_lead_status.complained_count + excluded.complained_count,
    unsubscribed_count = public.mail_campaign_lead_status.unsubscribed_count + excluded.unsubscribed_count,
    priority_bucket = public.atlas_mail_priority_bucket(
      public.mail_campaign_lead_status.clicked or excluded.clicked,
      public.mail_campaign_lead_status.opened or excluded.opened,
      public.mail_campaign_lead_status.bounced or excluded.bounced,
      public.mail_campaign_lead_status.complained or excluded.complained,
      public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
      public.mail_campaign_lead_status.delivered or excluded.delivered,
      public.mail_campaign_lead_status.sent or excluded.sent
    ),
    priority_rank = public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
      public.mail_campaign_lead_status.clicked or excluded.clicked,
      public.mail_campaign_lead_status.opened or excluded.opened,
      public.mail_campaign_lead_status.bounced or excluded.bounced,
      public.mail_campaign_lead_status.complained or excluded.complained,
      public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
      public.mail_campaign_lead_status.delivered or excluded.delivered,
      public.mail_campaign_lead_status.sent or excluded.sent
    )),
    priority_reason = public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
      public.mail_campaign_lead_status.clicked or excluded.clicked,
      public.mail_campaign_lead_status.opened or excluded.opened,
      public.mail_campaign_lead_status.bounced or excluded.bounced,
      public.mail_campaign_lead_status.complained or excluded.complained,
      public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
      public.mail_campaign_lead_status.delivered or excluded.delivered,
      public.mail_campaign_lead_status.sent or excluded.sent
    )),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists mail_result_contacts_project_campaign_status on public.mail_result_contacts;
create trigger mail_result_contacts_project_campaign_status
after insert on public.mail_result_contacts
for each row execute function public.project_mail_campaign_lead_status();

-- Reemplaza las lecturas creadas en 20260730190000 con la proyección correcta
-- sin cambiar sus firmas, de modo que reportes y consumidores actuales siguen
-- conectados mientras la consola nueva consume las funciones operacionales.
create or replace function public.get_mail_engagement_page(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null,
  p_limit integer default 101, p_after_priority_rank integer default null,
  p_after_last_event_at timestamptz default null, p_after_lead_id uuid default null
)
returns table (mail_campaign_id uuid, mail_campaign_name text, campaign_id uuid,
  campaign_name text, lead_id uuid, full_name text, rut text, phone text,
  email text, assigned_to uuid, assigned_to_name text, team_id uuid,
  opened boolean, clicked boolean, last_event_at timestamptz,
  priority_rank integer, priority_reason text)
language sql security definer set search_path = public as $$
  with access_check as (
    select public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  )
  select mc.id, coalesce(mc.name, c.name), s.campaign_id, c.name, l.id,
    l.full_name, l.rut, l.phone, l.email, l.assigned_to, p.full_name, l.team_id,
    s.opened, s.clicked, s.last_seen_at, s.priority_rank,
    coalesce(s.priority_reason, case when s.clicked then 'Click detectado en campaña mail' else 'Apertura detectada en campaña mail' end)
  from public.mail_campaign_lead_status s
  join public.mail_campaigns mc on mc.id = s.mail_campaign_id
  join public.leads l on l.id = s.lead_id
  join public.campaigns c on c.id = s.campaign_id
  left join public.profiles p on p.id = l.assigned_to
  cross join access_check ac
  where (s.opened or s.clicked)
    and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
    and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
    and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    and (p_after_priority_rank is null or s.priority_rank > p_after_priority_rank
      or (s.priority_rank = p_after_priority_rank and (s.last_seen_at < p_after_last_event_at
        or (s.last_seen_at = p_after_last_event_at and s.lead_id > p_after_lead_id))))
  order by s.priority_rank asc, s.last_seen_at desc, s.lead_id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

create or replace function public.get_mail_engagement_report_read_model(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null
)
returns table (mail_campaign_id uuid, mail_campaign_name text, campaign_id uuid,
  campaign_name text, sent_leads integer, delivered_leads integer,
  opened_leads integer, clicked_leads integer, hot_leads integer,
  assigned_hot_leads integer, managed_hot_leads integer, last_event_at timestamptz)
language sql security definer set search_path = public as $$
  with access_check as (
    select public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  )
  select mc.id, coalesce(mc.name, c.name), s.campaign_id, c.name,
    count(*) filter (where s.sent)::integer,
    count(*) filter (where s.delivered)::integer,
    count(*) filter (where s.opened)::integer,
    count(*) filter (where s.clicked)::integer,
    count(*) filter (where s.opened or s.clicked)::integer,
    count(*) filter (where (s.opened or s.clicked) and l.assigned_to is not null)::integer,
    count(*) filter (where (s.opened or s.clicked) and (l.assignment_status = 'managed' or l.workflow_status = 'managed'))::integer,
    max(s.last_seen_at)
  from public.mail_campaign_lead_status s
  join public.mail_campaigns mc on mc.id = s.mail_campaign_id
  join public.leads l on l.id = s.lead_id
  join public.campaigns c on c.id = s.campaign_id
  cross join access_check ac
  where (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
    and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
    and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  group by mc.id, mc.name, s.campaign_id, c.name
  order by max(s.last_seen_at) desc nulls last, coalesce(mc.name, c.name);
$$;

create or replace function public.get_mail_agent_control_summary_read_model(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null
)
returns table (agent_id uuid, agent_name text, assigned_leads integer,
  clicked_leads integer, opened_only_leads integer, uncontacted_leads integer,
  clicked_uncontacted_leads integer, contacted_leads integer, interactions integer,
  agendas integer, pending_agendas integer, overdue_agendas integer,
  no_next_action_leads integer, next_agenda_at timestamptz,
  last_interaction_at timestamptz, last_event_at timestamptz)
language sql security definer set search_path = public as $$
  with access_check as (
    select public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ), candidate_leads_raw as (
    select s.lead_id, s.opened, s.clicked, s.last_seen_at as last_event_at,
      s.priority_rank, l.assigned_to, l.next_action_at
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    cross join access_check ac
    where (s.opened or s.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), candidate_leads as (
    -- La carga de un ejecutivo es por lead, incluso si recibió dos mailings.
    -- Conservamos la señal más urgente/reciente para no duplicar gestiones.
    select distinct on (lead_id)
      lead_id, opened, clicked, last_event_at, assigned_to, next_action_at
    from candidate_leads_raw
    order by lead_id, priority_rank asc, last_event_at desc
  ), interaction_owners as (
    select cl.lead_id, coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) as owner_id,
      coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre') as owner_name,
      count(i.id)::integer as interaction_count, max(i.created_at) as last_interaction_at
    from candidate_leads cl
    join public.interactions i on i.lead_id = cl.lead_id
    left join public.historical_agents ha on ha.id = i.historical_agent_id
    left join public.profiles linked on linked.id = ha.linked_profile_id
    left join public.profiles p on p.id = i.agent_id
    where coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) is not null
    group by cl.lead_id, coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id), coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre')
  ), assignment_owners as (
    select cl.lead_id, cl.assigned_to as owner_id, p.full_name as owner_name,
      0::integer as interaction_count, null::timestamptz as last_interaction_at
    from candidate_leads cl join public.profiles p on p.id = cl.assigned_to
    where cl.assigned_to is not null and not exists (
      select 1 from interaction_owners io where io.lead_id = cl.lead_id and io.owner_id = cl.assigned_to
    )
  ), owner_rows as (
    select * from interaction_owners union all select * from assignment_owners
  )
  select o.owner_id, max(o.owner_name), count(distinct cl.lead_id)::integer,
    count(distinct cl.lead_id) filter (where cl.clicked)::integer,
    count(distinct cl.lead_id) filter (where cl.opened and not cl.clicked)::integer,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) = 0)::integer,
    count(distinct cl.lead_id) filter (where cl.clicked and coalesce(o.interaction_count, 0) = 0)::integer,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) > 0)::integer,
    coalesce(sum(o.interaction_count), 0)::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null)::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at > now())::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now())::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is null)::integer,
    min(cl.next_action_at) filter (where cl.next_action_at is not null),
    max(o.last_interaction_at), max(cl.last_event_at)
  from owner_rows o join candidate_leads cl on cl.lead_id = o.lead_id
  group by o.owner_id
  order by count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now()) desc,
    count(distinct cl.lead_id) filter (where cl.clicked) desc, count(distinct cl.lead_id) desc, max(o.owner_name);
$$;

create or replace function public.get_mail_operational_bucket_summary(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null
)
returns table (bucket text, label text, sort_order integer, lead_count integer,
  oldest_event_at timestamptz, nearest_action_at timestamptz)
language sql security definer set search_path = public as $$
  with clock as (select now() as observed_at), access_check as (
    select public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ), candidate_leads as (
    select s.opened, s.clicked, s.last_seen_at as last_event_at, l.assigned_to,
      l.next_action_at, l.assignment_status, l.workflow_status,
      latest.last_interaction_at, clock.observed_at
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    cross join clock cross join access_check ac
    left join lateral (
      select i.created_at as last_interaction_at from public.interactions i
      where i.lead_id = s.lead_id order by i.created_at desc limit 1
    ) latest on true
    where (s.opened or s.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), work_items as (
    select cl.*, case
      when cl.next_action_at is not null and cl.next_action_at <= cl.observed_at then 'overdue'
      when cl.assigned_to is null then 'unassigned'
      when cl.clicked and cl.last_interaction_at is null then 'clicked_uncontacted'
      when cl.opened and not cl.clicked and cl.last_interaction_at is null then 'opened_uncontacted'
      when cl.next_action_at is not null and cl.next_action_at > cl.observed_at then 'next_action'
      when cl.workflow_status = 'managed' or cl.assignment_status = 'managed' then 'managed'
      else 'monitor'
    end as work_bucket
    from candidate_leads cl
  )
  select 'overdue'::text, 'Agenda vencida'::text, 10,
    count(*) filter (where work_bucket = 'overdue')::integer,
    min(last_event_at) filter (where work_bucket = 'overdue'),
    min(next_action_at) filter (where work_bucket = 'overdue') from work_items
  union all select 'unassigned', 'Sin asignar', 20,
    count(*) filter (where work_bucket = 'unassigned')::integer,
    min(last_event_at) filter (where work_bucket = 'unassigned'), null::timestamptz from work_items
  union all select 'clicked_uncontacted', 'Click sin gestión', 30,
    count(*) filter (where work_bucket = 'clicked_uncontacted')::integer,
    min(last_event_at) filter (where work_bucket = 'clicked_uncontacted'), null::timestamptz from work_items
  union all select 'opened_uncontacted', 'Apertura sin gestión', 40,
    count(*) filter (where work_bucket = 'opened_uncontacted')::integer,
    min(last_event_at) filter (where work_bucket = 'opened_uncontacted'), null::timestamptz from work_items
  union all select 'next_action', 'Próxima acción', 50,
    count(*) filter (where work_bucket = 'next_action')::integer,
    min(last_event_at) filter (where work_bucket = 'next_action'),
    min(next_action_at) filter (where work_bucket = 'next_action') from work_items
  union all select 'managed', 'Gestionados', 60,
    count(*) filter (where work_bucket = 'managed')::integer,
    min(last_event_at) filter (where work_bucket = 'managed'), null::timestamptz from work_items
  union all select 'monitor', 'En seguimiento', 70,
    count(*) filter (where work_bucket = 'monitor')::integer,
    min(last_event_at) filter (where work_bucket = 'monitor'), null::timestamptz from work_items
  order by 3;
$$;

create or replace function public.get_mail_operational_queue_page(
  p_mail_campaign_id uuid default null, p_campaign_id uuid default null,
  p_bucket text default null, p_limit integer default 101,
  p_after_work_rank integer default null, p_after_priority_rank integer default null,
  p_after_last_event_at timestamptz default null, p_after_lead_id uuid default null
)
returns table (mail_campaign_id uuid, mail_campaign_name text, campaign_id uuid,
  campaign_name text, lead_id uuid, full_name text, rut text, phone text, email text,
  assigned_to uuid, assigned_to_name text, team_id uuid, next_action_at timestamptz,
  assignment_status text, workflow_status text, opened boolean, clicked boolean,
  last_event_at timestamptz, last_interaction_at timestamptz, priority_rank integer,
  priority_reason text, work_bucket text, work_rank integer, is_unassigned boolean,
  is_clicked_uncontacted boolean, is_opened_uncontacted boolean, is_overdue boolean,
  has_next_action boolean)
language sql security definer set search_path = public as $$
  with clock as (select now() as observed_at), access_check as (
    select public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ), candidates as (
    select mc.id as mail_campaign_id, coalesce(mc.name, c.name) as mail_campaign_name,
      s.campaign_id, c.name as campaign_name, l.id as lead_id, l.full_name, l.rut,
      l.phone, l.email, l.assigned_to, p.full_name as assigned_to_name, l.team_id,
      l.next_action_at, l.assignment_status, l.workflow_status, s.opened, s.clicked,
      s.last_seen_at as last_event_at, latest.last_interaction_at, s.priority_rank,
      coalesce(s.priority_reason, case when s.clicked then 'Click detectado en campaña mail' else 'Apertura detectada en campaña mail' end) as priority_reason,
      l.assigned_to is null as is_unassigned,
      (s.clicked and latest.last_interaction_at is null) as is_clicked_uncontacted,
      (s.opened and not s.clicked and latest.last_interaction_at is null) as is_opened_uncontacted,
      (l.next_action_at is not null and l.next_action_at <= clock.observed_at) as is_overdue,
      (l.next_action_at is not null and l.next_action_at > clock.observed_at) as has_next_action
    from public.mail_campaign_lead_status s
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    join public.leads l on l.id = s.lead_id
    join public.campaigns c on c.id = s.campaign_id
    left join public.profiles p on p.id = l.assigned_to
    cross join clock cross join access_check ac
    left join lateral (
      select i.created_at as last_interaction_at from public.interactions i
      where i.lead_id = s.lead_id order by i.created_at desc limit 1
    ) latest on true
    where (s.opened or s.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), work_items as (
    select c.*, case when c.is_overdue then 'overdue' when c.is_unassigned then 'unassigned'
      when c.is_clicked_uncontacted then 'clicked_uncontacted' when c.is_opened_uncontacted then 'opened_uncontacted'
      when c.has_next_action then 'next_action' when c.workflow_status = 'managed' or c.assignment_status = 'managed' then 'managed' else 'monitor' end as work_bucket,
      case when c.is_overdue then 10 when c.is_unassigned then 20 when c.is_clicked_uncontacted then 30
      when c.is_opened_uncontacted then 40 when c.has_next_action then 50
      when c.workflow_status = 'managed' or c.assignment_status = 'managed' then 60 else 70 end as work_rank
    from candidates c
  )
  select wi.mail_campaign_id, wi.mail_campaign_name, wi.campaign_id, wi.campaign_name,
    wi.lead_id, wi.full_name, wi.rut, wi.phone, wi.email, wi.assigned_to,
    wi.assigned_to_name, wi.team_id, wi.next_action_at, wi.assignment_status,
    wi.workflow_status, wi.opened, wi.clicked, wi.last_event_at, wi.last_interaction_at,
    wi.priority_rank, wi.priority_reason, wi.work_bucket, wi.work_rank,
    wi.is_unassigned, wi.is_clicked_uncontacted, wi.is_opened_uncontacted,
    wi.is_overdue, wi.has_next_action
  from work_items wi
  where (p_bucket is null or p_bucket = 'all' or p_bucket = wi.work_bucket)
    and (p_after_work_rank is null or wi.work_rank > p_after_work_rank
      or (wi.work_rank = p_after_work_rank and (wi.priority_rank > p_after_priority_rank
        or (wi.priority_rank = p_after_priority_rank and (wi.last_event_at < p_after_last_event_at
          or (wi.last_event_at = p_after_last_event_at and wi.lead_id > p_after_lead_id))))))
  order by wi.work_rank asc, wi.priority_rank asc, wi.last_event_at desc, wi.lead_id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

alter table public.mail_campaign_lead_status enable row level security;
revoke all on table public.mail_campaign_lead_status from anon, authenticated;

revoke all on function public.get_mail_engagement_page(uuid, uuid, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_mail_engagement_page(uuid, uuid, integer, integer, timestamptz, uuid) to authenticated, service_role;
revoke all on function public.get_mail_engagement_report_read_model(uuid, uuid) from public, anon;
grant execute on function public.get_mail_engagement_report_read_model(uuid, uuid) to authenticated, service_role;
revoke all on function public.get_mail_agent_control_summary_read_model(uuid, uuid) from public, anon;
grant execute on function public.get_mail_agent_control_summary_read_model(uuid, uuid) to authenticated, service_role;
revoke all on function public.get_mail_operational_bucket_summary(uuid, uuid) from public, anon;
grant execute on function public.get_mail_operational_bucket_summary(uuid, uuid) to authenticated, service_role;
revoke all on function public.get_mail_operational_queue_page(uuid, uuid, text, integer, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_mail_operational_queue_page(uuid, uuid, text, integer, integer, integer, timestamptz, uuid) to authenticated, service_role;

commit;
