-- El correo de la clínica sale por Atlas Lead, por el puente que ya existe.
--
-- Atlas 2.0 ya le pide a Atlas Lead que envíe correos (las respuestas de
-- campaña viajan por el outbox firmado v2). Un correo de clínica es el mismo
-- pedido, sin campaña: a nombre de la clínica, con la respuesta dirigida a su
-- buzón. Acá se encola y se sigue el acuse: entregado al puente es enviado;
-- carta muerta es fallido.

alter table public.mensajes_salientes add column if not exists outbox_event_id uuid references public.integration_outbox_events(id) on delete set null;
create index if not exists mensajes_salientes_outbox_idx on public.mensajes_salientes (outbox_event_id) where outbox_event_id is not null;

create or replace function public.encolar_correo_en_atlas_lead(p_mensaje uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_mensaje public.mensajes_salientes%rowtype;
  v_clinica text;
  v_buzon text;
  v_evento uuid;
begin
  select * into v_mensaje from public.mensajes_salientes where id = p_mensaje;
  if not found then
    raise exception 'No encontramos ese mensaje' using errcode = 'P0002';
  end if;
  if v_mensaje.canal <> 'correo' or v_mensaje.cuerpo is null then
    raise exception 'Solo se encolan correos ya redactados' using errcode = '22023';
  end if;
  select name into v_clinica from public.organizations where id = v_mensaje.organization_id;
  select address into v_buzon from public.inbound_mailboxes where organization_id = v_mensaje.organization_id and campaign_id is null and active limit 1;

  v_evento := public.enqueue_integration_outbox_v2(
    'atlas_lead',
    'clinica-mail:' || v_mensaje.id::text,
    'mail.send.requested.v1',
    jsonb_build_object(
      'crm_message_id', v_mensaje.id,
      'organization_id', v_mensaje.organization_id,
      'sender_name', coalesce(v_clinica, 'Atlas'),
      'reply_to', v_buzon,
      'recipient_email', lower(btrim(v_mensaje.destinatario)),
      'recipient_name', v_mensaje.nombre_destinatario,
      'subject', coalesce(v_mensaje.asunto, 'Mensaje de ' || coalesce(v_clinica, 'la clínica')),
      'body_text', v_mensaje.cuerpo,
      'external_key', v_mensaje.id
    ),
    'mensaje_saliente', v_mensaje.id::text
  );

  update public.mensajes_salientes
     set estado = 'enviando', proveedor = 'atlas_lead', proveedor_id = v_evento::text, outbox_event_id = v_evento, error = null, updated_at = now()
   where id = p_mensaje;
  return v_evento;
end;
$$;

revoke all on function public.encolar_correo_en_atlas_lead(uuid) from public, anon, authenticated;
grant execute on function public.encolar_correo_en_atlas_lead(uuid) to service_role;

-- El acuse del puente cierra el mensaje.
create or replace function public.reflejar_acuse_de_outbox_en_saliente()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'delivered' then
      update public.mensajes_salientes set estado = 'enviado', enviado_at = coalesce(enviado_at, now()), error = null, updated_at = now()
       where outbox_event_id = new.id and estado in ('enviando', 'programado');
    elsif new.status = 'dead_letter' then
      update public.mensajes_salientes set estado = 'fallido', error = left(coalesce(new.last_error_detail, new.last_error_code, 'Atlas Lead no aceptó el correo'), 800), updated_at = now()
       where outbox_event_id = new.id and estado in ('enviando', 'programado');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists integration_outbox_events_reflejan_saliente on public.integration_outbox_events;
create trigger integration_outbox_events_reflejan_saliente
  after update of status on public.integration_outbox_events
  for each row execute function public.reflejar_acuse_de_outbox_en_saliente();
