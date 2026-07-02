-- CRM foundation: contacts normalized off the lead record, and one
-- RLS-respecting payload for the lead 360 view.

create or replace function public.normalize_lead_contact(contact_type text, value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when contact_type = 'phone' then regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')
    when contact_type = 'email' then lower(btrim(coalesce(value, '')))
    else btrim(coalesce(value, ''))
  end;
$$;

create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_type text not null check (contact_type in ('phone', 'email')),
  value text not null,
  normalized_value text not null,
  label text,
  is_primary boolean not null default false,
  is_valid boolean,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_contacts_value_not_blank check (btrim(value) <> ''),
  constraint lead_contacts_normalized_not_blank check (btrim(normalized_value) <> '')
);

create index if not exists lead_contacts_lead_id_idx
  on public.lead_contacts (lead_id);

create index if not exists lead_contacts_lookup_idx
  on public.lead_contacts (contact_type, normalized_value);

create unique index if not exists lead_contacts_lead_type_norm_uidx
  on public.lead_contacts (lead_id, contact_type, normalized_value);

drop trigger if exists lead_contacts_set_updated_at on public.lead_contacts;
create trigger lead_contacts_set_updated_at
before update on public.lead_contacts
for each row execute function public.set_updated_at();

alter table public.lead_contacts enable row level security;

drop policy if exists lead_contacts_select on public.lead_contacts;
create policy lead_contacts_select
on public.lead_contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
  )
);

drop policy if exists lead_contacts_insert on public.lead_contacts;
create policy lead_contacts_insert
on public.lead_contacts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
  )
);

drop policy if exists lead_contacts_update on public.lead_contacts;
create policy lead_contacts_update
on public.lead_contacts
for update
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
  )
);

drop policy if exists lead_contacts_delete_admin on public.lead_contacts;
create policy lead_contacts_delete_admin
on public.lead_contacts
for delete
to authenticated
using ((select public.current_role_name()) = 'admin');

insert into public.lead_contacts (
  lead_id,
  contact_type,
  value,
  normalized_value,
  is_primary,
  source
)
select
  l.id,
  'phone',
  l.phone,
  public.normalize_lead_contact('phone', l.phone),
  true,
  'leads.phone'
from public.leads l
where l.phone is not null
  and btrim(l.phone) <> ''
  and public.normalize_lead_contact('phone', l.phone) <> ''
on conflict (lead_id, contact_type, normalized_value) do nothing;

insert into public.lead_contacts (
  lead_id,
  contact_type,
  value,
  normalized_value,
  is_primary,
  source
)
select
  l.id,
  'email',
  l.email,
  public.normalize_lead_contact('email', l.email),
  true,
  'leads.email'
from public.leads l
where l.email is not null
  and btrim(l.email) <> ''
  and public.normalize_lead_contact('email', l.email) <> ''
on conflict (lead_id, contact_type, normalized_value) do nothing;

create or replace function public.get_lead_360(p_lead_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with visible_lead as (
  select l.*
  from public.leads l
  where l.id = p_lead_id
  limit 1
),
timeline_rows as (
  select
    'call'::text as source,
    c.id,
    c.ended_at as occurred_at,
    coalesce(c.reason, c.outcome, c.status, 'Llamada') as title,
    c.notes,
    c.next_action_at,
    coalesce(ha.full_name, p.full_name, '—') as agent_name,
    jsonb_build_object(
      'status', c.status,
      'outcome', c.outcome,
      'reason', c.reason,
      'discarded_reason', c.discarded_reason,
      'equifax_products', c.equifax_products,
      'equifax_uf_amount', c.equifax_uf_amount
    ) as metadata
  from public.calls c
  join visible_lead vl on vl.id = c.lead_id
  left join public.profiles p on p.id = c.agent_id
  left join public.historical_agents ha on ha.id = c.historical_agent_id
  where c.ended_at is not null
    and (c.reason is not null or c.notes is not null or c.discarded_reason is not null)

  union all

  select
    'interaction'::text as source,
    i.id,
    i.created_at as occurred_at,
    i.result as title,
    i.notes,
    null::timestamptz as next_action_at,
    coalesce(ha.full_name, p.full_name, '—') as agent_name,
    coalesce(i.metadata, '{}'::jsonb) as metadata
  from public.interactions i
  join visible_lead vl on vl.id = i.lead_id
  left join public.profiles p on p.id = i.agent_id
  left join public.historical_agents ha on ha.id = i.historical_agent_id
),
timeline_limited as (
  select *
  from timeline_rows
  order by occurred_at desc nulls last
  limit 60
)
select case
  when not exists (select 1 from visible_lead) then null
  else jsonb_build_object(
    'lead', (select to_jsonb(vl) from visible_lead vl),
    'contacts', (
      select coalesce(
        jsonb_agg(to_jsonb(c) order by c.is_primary desc, c.contact_type, c.created_at),
        '[]'::jsonb
      )
      from public.lead_contacts c
      join visible_lead vl on vl.id = c.lead_id
    ),
    'campaign', (
      select to_jsonb(c)
      from public.campaigns c
      join visible_lead vl on vl.campaign_id = c.id
    ),
    'team', (
      select to_jsonb(t)
      from public.teams t
      join visible_lead vl on vl.team_id = t.id
    ),
    'assigned_profile', (
      select to_jsonb(p)
      from public.profiles p
      join visible_lead vl on vl.assigned_to = p.id
    ),
    'managed_profile', (
      select to_jsonb(p)
      from public.profiles p
      join visible_lead vl on vl.managed_by = p.id
    ),
    'workflow', (
      select to_jsonb(w)
      from public.workflows w
      join visible_lead vl on w.id = coalesce(
        vl.workflow_id,
        (select c.workflow_id from public.campaigns c where c.id = vl.campaign_id)
      )
    ),
    'summary', (
      select jsonb_build_object(
        'timeline_count', count(*),
        'last_activity_at', max(occurred_at),
        'next_action_at', (select vl.next_action_at from visible_lead vl)
      )
      from timeline_rows
    ),
    'timeline', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source', source,
            'id', id,
            'occurred_at', occurred_at,
            'title', title,
            'notes', notes,
            'next_action_at', next_action_at,
            'agent_name', agent_name,
            'metadata', metadata
          )
          order by occurred_at desc nulls last
        ),
        '[]'::jsonb
      )
      from timeline_limited
    )
  )
end;
$$;

revoke all on function public.normalize_lead_contact(text, text) from public, anon;
grant execute on function public.normalize_lead_contact(text, text) to authenticated;

revoke all on function public.get_lead_360(uuid) from public, anon;
grant execute on function public.get_lead_360(uuid) to authenticated;
