-- Estado deseado (agent_sip_credentials) y estado realmente reconciliado en
-- Asterisk son verdades distintas. Esta tabla materializa el resultado por
-- agente para que operaciones no confunda una credencial existente con un
-- endpoint utilizable y para que el motor pueda converger de forma observable.
create table public.agent_sip_provisioning_status (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  extension text not null,
  desired_updated_at timestamptz not null,
  status text not null default 'pending'
    check (status = any (array['pending', 'synced', 'error', 'disabled'])),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  failure_code text,
  engine_release text,
  updated_at timestamptz not null default now()
);

create unique index agent_sip_provisioning_status_extension_idx
  on public.agent_sip_provisioning_status (extension);

alter table public.agent_sip_provisioning_status enable row level security;
revoke all on table public.agent_sip_provisioning_status from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_sip_provisioning_status to service_role;

create or replace function public.record_agent_sip_provisioning(
  p_states jsonb,
  p_engine_release text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.request_is_service_role() then
    raise exception 'record_agent_sip_provisioning sólo puede ser llamada por el motor.';
  end if;

  insert into public.agent_sip_provisioning_status (
    profile_id,
    extension,
    desired_updated_at,
    status,
    last_attempt_at,
    last_success_at,
    failure_code,
    engine_release,
    updated_at
  )
  select
    credentials.profile_id,
    credentials.extension,
    credentials.updated_at,
    state ->> 'status',
    now(),
    case when state ->> 'status' = 'synced' then now() else null end,
    nullif(state ->> 'failure_code', ''),
    nullif(p_engine_release, ''),
    now()
  from jsonb_array_elements(coalesce(p_states, '[]'::jsonb)) state
  join public.agent_sip_credentials credentials
    on credentials.profile_id = (state ->> 'profile_id')::uuid
   and credentials.extension = state ->> 'extension'
   and credentials.is_active
   and credentials.updated_at = (state ->> 'desired_updated_at')::timestamptz
  on conflict (profile_id) do update
  set extension = excluded.extension,
      desired_updated_at = excluded.desired_updated_at,
      status = excluded.status,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = coalesce(excluded.last_success_at, agent_sip_provisioning_status.last_success_at),
      failure_code = excluded.failure_code,
      engine_release = excluded.engine_release,
      updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.record_agent_sip_provisioning(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_agent_sip_provisioning(jsonb, text) to service_role;

create or replace function public.mark_agent_sip_provisioning_pending()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.agent_sip_provisioning_status where profile_id = old.profile_id;
    return old;
  end if;

  insert into public.agent_sip_provisioning_status (
    profile_id, extension, desired_updated_at, status, failure_code, updated_at
  ) values (
    new.profile_id,
    new.extension,
    new.updated_at,
    case when new.is_active then 'pending' else 'disabled' end,
    null,
    now()
  )
  on conflict (profile_id) do update
  set extension = excluded.extension,
      desired_updated_at = excluded.desired_updated_at,
      status = excluded.status,
      failure_code = null,
      updated_at = now();

  return new;
end;
$function$;

revoke all on function public.mark_agent_sip_provisioning_pending() from public, anon, authenticated;

create trigger agent_sip_credentials_mark_provisioning_pending
  after insert or update of extension, sip_password, is_active on public.agent_sip_credentials
  for each row execute function public.mark_agent_sip_provisioning_pending();

create trigger agent_sip_credentials_remove_provisioning_status
  after delete on public.agent_sip_credentials
  for each row execute function public.mark_agent_sip_provisioning_pending();

insert into public.agent_sip_provisioning_status (
  profile_id, extension, desired_updated_at, status, updated_at
)
select
  profile_id,
  extension,
  updated_at,
  case when is_active then 'pending' else 'disabled' end,
  now()
from public.agent_sip_credentials
on conflict (profile_id) do update
set extension = excluded.extension,
    desired_updated_at = excluded.desired_updated_at,
    status = excluded.status,
    failure_code = null,
    updated_at = now();
