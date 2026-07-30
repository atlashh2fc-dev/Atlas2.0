-- El RPC validaba la lista de estados por su cuenta: sin esto, el estado
-- 'paused' que ahora emite el motor sería rechazado.
create or replace function public.update_agent_dialer_status(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_extension text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is not null then
    raise exception 'update_agent_dialer_status solo puede ser llamada por el motor de discado.';
  end if;

  if p_status not in ('offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused') then
    raise exception 'status % invalido.', p_status;
  end if;

  insert into public.dialer_agent_sessions (profile_id, campaign_id, extension, status, last_state_change_at)
  values (p_profile_id, p_campaign_id, p_extension, p_status, now())
  on conflict (profile_id, campaign_id) do update
  set extension = excluded.extension,
      status = excluded.status,
      last_state_change_at = case
        when public.dialer_agent_sessions.status <> excluded.status
        then now()
        else public.dialer_agent_sessions.last_state_change_at
      end,
      updated_at = now();
end;
$function$;
