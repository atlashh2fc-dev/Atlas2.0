-- Atlas Lead ya entrega eventos por el transporte durable Integration v2.
-- Estos dos RPC heredados conservan acceso para service_role, pero dejan de ser
-- una superficie directa para sesiones humanas autenticadas.

revoke execute on function public.sync_atlas_lead_mail_campaign(
  text, text, text, text, text, uuid, jsonb
) from public, anon, authenticated;

revoke execute on function public.apply_atlas_lead_mail_result_batch(
  text, text, jsonb, text, date, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.sync_atlas_lead_mail_campaign(
  text, text, text, text, text, uuid, jsonb
) to service_role;

grant execute on function public.apply_atlas_lead_mail_result_batch(
  text, text, jsonb, text, date, text, text, text, text, text, jsonb
) to service_role;

comment on function public.sync_atlas_lead_mail_campaign(
  text, text, text, text, text, uuid, jsonb
) is 'Legacy Atlas Lead sync. Service-role only; new traffic uses Integration v2.';

comment on function public.apply_atlas_lead_mail_result_batch(
  text, text, jsonb, text, date, text, text, text, text, text, jsonb
) is 'Legacy Atlas Lead result ingest. Service-role only; new traffic uses Integration v2.';

do $guard$
begin
  if has_function_privilege(
    'anon',
    'public.sync_atlas_lead_mail_campaign(text,text,text,text,text,uuid,jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.sync_atlas_lead_mail_campaign(text,text,text,text,text,uuid,jsonb)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.apply_atlas_lead_mail_result_batch(text,text,jsonb,text,date,text,text,text,text,text,jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.apply_atlas_lead_mail_result_batch(text,text,jsonb,text,date,text,text,text,text,text,jsonb)',
    'execute'
  ) then
    raise exception 'Los RPC legacy de Atlas Lead siguen expuestos a roles cliente.';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.sync_atlas_lead_mail_campaign(text,text,text,text,text,uuid,jsonb)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_atlas_lead_mail_result_batch(text,text,jsonb,text,date,text,text,text,text,text,jsonb)',
    'execute'
  ) then
    raise exception 'Los RPC legacy de Atlas Lead perdieron el acceso service_role.';
  end if;
end
$guard$;
