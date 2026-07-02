create or replace function public.claim_next_dial_targets(
  p_campaign_id uuid,
  p_batch_size int default 1
)
returns table (
  dial_attempt_id uuid,
  lead_id uuid,
  phone text,
  full_name text,
  rut text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  return query
  with candidates as (
    select l.id, l.phone, l.full_name, l.rut
    from public.leads l
    where l.campaign_id = p_campaign_id
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (l.next_action_at is null or l.next_action_at <= now())
      and not exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
    order by l.external_priority_rank asc nulls last, l.next_action_at asc nulls last, l.updated_at asc
    limit p_batch_size
    for update of l skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select c.id, p_campaign_id, c.phone, 'queued'
    from candidates c
    returning public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select i.inserted_attempt_id, i.inserted_lead_id, c.phone, c.full_name, c.rut
  from inserted i
  join candidates c on c.id = i.inserted_lead_id;
end;
$function$;

revoke all on function public.claim_next_dial_targets(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_next_dial_targets(uuid, int) to service_role;
