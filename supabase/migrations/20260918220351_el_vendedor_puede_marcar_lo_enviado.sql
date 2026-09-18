-- Cuando el agente contesta solo, queda constancia de que fue él.
--
-- Si mañana un contacto reclama por algo que se le dijo, tiene que poder
-- rastrearse hasta el borrador exacto y la corrida que lo produjo. Un agente sin
-- trazabilidad es un agente que no se puede corregir.

create or replace function public.marcar_borrador_enviado_por_agente(
  p_draft_id uuid,
  p_proveedor_id text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_draft public.sales_agent_drafts%rowtype;
begin
  select * into v_draft from public.sales_agent_drafts where id = p_draft_id;
  if not found then
    raise exception 'El borrador % no existe', p_draft_id;
  end if;

  if v_draft.escalar then
    raise exception 'Un borrador escalado no lo envía el agente';
  end if;

  update public.sales_agent_drafts
     set estado = 'enviado', decidido_at = now()
   where id = p_draft_id and estado = 'pendiente';

  if v_draft.opportunity_id is not null then
    insert into public.sales_activities (
      organization_id, opportunity_id, kind, subject, body, occurred_at, done, metadata
    )
    values (
      v_draft.organization_id, v_draft.opportunity_id, 'correo',
      'Atlas Vendedor respondió el correo',
      v_draft.cuerpo, now(), true,
      jsonb_build_object('agente', 'vendedor', 'draft_id', p_draft_id,
                         'proveedor_id', p_proveedor_id, 'automatico', true)
    );

    update public.sales_opportunities
       set next_action_at = now() + interval '2 days',
           next_action_note = 'Atlas respondió: esperar su reacción o insistir en la reunión',
           updated_at = now()
     where id = v_draft.opportunity_id;
  end if;
end;
$$;

revoke all on function public.marcar_borrador_enviado_por_agente(uuid, text) from public;
revoke execute on function public.marcar_borrador_enviado_por_agente(uuid, text) from anon, authenticated;
grant execute on function public.marcar_borrador_enviado_por_agente(uuid, text) to service_role;
