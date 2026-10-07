-- La firma solo puede traer trazos: fuera cualquier atributo on*, imagen,
-- <use>, <style> o <foreignObject>.
create or replace function public.firmar_consentimiento_interno(p_id uuid, p_token text, p_nombre text, p_rut text, p_firma text, p_desde text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_doc public.consentimientos%rowtype;
begin
  if nullif(btrim(coalesce(p_nombre, '')), '') is null or length(btrim(p_nombre)) < 3 then
    raise exception 'Escribe el nombre de quien firma' using errcode = '22023';
  end if;
  if p_firma is null or length(p_firma) < 40 or length(p_firma) > 200000 or p_firma !~ '^<svg[\s\S]*</svg>$' or p_firma ~* '(<script|javascript:|href\s*=|xlink|\son[a-z]+\s*=|<foreignobject|<image|<use|<style)' then
    raise exception 'Falta la firma' using errcode = '22023';
  end if;
  update public.consentimientos
     set estado = 'firmado', firmante_nombre = left(btrim(p_nombre), 120), firmante_rut = nullif(left(btrim(coalesce(p_rut, '')), 20), ''),
         firma_svg = p_firma, firmado_at = now(), firmado_desde = p_desde
   where estado = 'pendiente'
     and ((p_id is not null and id = p_id) or (p_token is not null and length(p_token) >= 32 and token = p_token))
  returning * into v_doc;
  if v_doc.id is null then return false; end if;
  insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
  values (v_doc.organization_id, v_doc.cuenta_id, 'nota', 'Consentimiento firmado: ' || v_doc.titulo,
          'Firmó ' || v_doc.firmante_nombre || coalesce(' (' || v_doc.firmante_rut || ')', '') || case when p_desde = 'enlace' then ' desde el enlace' else ' en la clínica' end, now(), true);
  return true;
end;
$$;
revoke all on function public.firmar_consentimiento_interno(uuid, text, text, text, text, text) from public, anon, authenticated;
