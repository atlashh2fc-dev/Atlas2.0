-- El agente escribía bien y el guardado lo botaba.
--
-- El índice que evita contestar dos veces el mismo correo es parcial:
-- `where mail_message_id is not null`. Postgres no lo reconoce en un
-- `on conflict (mail_message_id)` a secas; hay que repetir su condición. Sin
-- eso, cada intento moría con "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" y las tres respuestas redactadas se
-- perdieron después de haberle pagado al modelo por escribirlas.

create or replace function public.guardar_borrador_de_venta(
  p_organization_slug text,
  p_mail_message_id uuid,
  p_lead_id uuid,
  p_opportunity_id uuid,
  p_para_email text,
  p_asunto text,
  p_cuerpo text,
  p_intencion text,
  p_razonamiento text,
  p_escalar boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_id uuid;
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;

  insert into public.sales_agent_drafts (
    organization_id, opportunity_id, lead_id, mail_message_id,
    para_email, asunto, cuerpo, intencion, razonamiento, escalar
  )
  values (
    v_org, p_opportunity_id, p_lead_id, p_mail_message_id,
    p_para_email, p_asunto, p_cuerpo, p_intencion, p_razonamiento, coalesce(p_escalar, false)
  )
  on conflict (mail_message_id) where mail_message_id is not null do nothing
  returning id into v_id;

  -- Que alguien respondió es, en sí, la señal más fuerte del embudo.
  if v_id is not null and p_opportunity_id is not null then
    update public.sales_opportunities
       set next_action_at = least(coalesce(next_action_at, now()), now()),
           next_action_note = case
             when coalesce(p_escalar, false) then 'Respondió y necesita que lo veas tú: ' || coalesce(p_intencion, 'sin clasificar')
             else 'Respondió el correo: hay una respuesta lista para revisar'
           end,
           updated_at = now()
     where id = p_opportunity_id and organization_id = v_org;

    insert into public.sales_activities (
      organization_id, opportunity_id, kind, subject, body, occurred_at, done, metadata
    )
    values (
      v_org, p_opportunity_id, 'correo',
      'Respondió a la campaña' || case when coalesce(p_escalar, false) then ' · necesita a Hugo' else '' end,
      coalesce(p_intencion, 'sin clasificar'), now(), true,
      jsonb_build_object('agente', 'vendedor', 'draft_id', v_id)
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.guardar_borrador_de_venta(text, uuid, uuid, uuid, text, text, text, text, text, boolean) from public;
revoke execute on function public.guardar_borrador_de_venta(text, uuid, uuid, uuid, text, text, text, text, text, boolean) from anon, authenticated;
grant execute on function public.guardar_borrador_de_venta(text, uuid, uuid, uuid, text, text, text, text, text, boolean) to service_role;
