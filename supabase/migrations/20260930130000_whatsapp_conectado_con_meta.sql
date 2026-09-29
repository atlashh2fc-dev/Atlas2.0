-- Conectar WhatsApp desde Atlas, con la app de Meta de Altius.
--
-- Altius es proveedor de tecnología en Meta (app «Atlas CRM»). Cada empresa
-- conecta su número desde Integraciones › WhatsApp con el registro insertado
-- de Meta; si el número ya vive en la app WhatsApp Business del teléfono, sigue
-- ahí (coexistencia). Meta entrega un token por empresa: se guarda cifrado en la
-- bóveda y solo el servidor lo lee. El canal de Geimser, conectado a mano con
-- la app antigua, sigue usando el token del entorno.

alter table public.whatsapp_channels
  add column if not exists token_secreto uuid,
  add column if not exists coexistencia boolean not null default false,
  add column if not exists conectado_at timestamptz;

comment on column public.whatsapp_channels.token_secreto is
  'Id en vault.secrets del token de Meta de esta empresa. Nulo: se usa WHATSAPP_ACCESS_TOKEN del entorno.';
comment on column public.whatsapp_channels.coexistencia is
  'El número sigue en la app WhatsApp Business del teléfono además de Atlas.';

create or replace function public.guardar_token_de_canal_whatsapp(p_channel_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_secreto uuid;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'Token vacío' using errcode = '22023';
  end if;
  select token_secreto into v_secreto from public.whatsapp_channels where id = p_channel_id for update;
  if not found then
    raise exception 'Canal inexistente' using errcode = 'P0002';
  end if;
  if v_secreto is null then
    v_secreto := vault.create_secret(p_token, 'whatsapp:' || p_channel_id::text || ':' || gen_random_uuid()::text, 'Token de Meta de un canal de WhatsApp');
    update public.whatsapp_channels set token_secreto = v_secreto where id = p_channel_id;
  else
    perform vault.update_secret(v_secreto, p_token);
  end if;
end;
$function$;

create or replace function public.token_de_canal_whatsapp(p_channel_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select secreto.decrypted_secret
  from public.whatsapp_channels canal
  join vault.decrypted_secrets secreto on secreto.id = canal.token_secreto
  where canal.id = p_channel_id;
$function$;

revoke all on function public.guardar_token_de_canal_whatsapp(uuid, text) from public;
revoke execute on function public.guardar_token_de_canal_whatsapp(uuid, text) from anon, authenticated;
grant execute on function public.guardar_token_de_canal_whatsapp(uuid, text) to service_role;

revoke all on function public.token_de_canal_whatsapp(uuid) from public;
revoke execute on function public.token_de_canal_whatsapp(uuid) from anon, authenticated;
grant execute on function public.token_de_canal_whatsapp(uuid) to service_role;
