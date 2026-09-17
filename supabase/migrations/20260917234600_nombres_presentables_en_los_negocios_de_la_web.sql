-- "paula guerra" no es como se llama una empresa en una pantalla de ventas.
--
-- Lo que la gente escribe en un formulario viene como salga: todo minúsculas,
-- todo mayúsculas, o bien escrito. Solo se corrigen los dos primeros casos; un
-- nombre con mayúsculas mezcladas ya trae intención (SpA, GmbH, McPherson) y
-- tocarlo sería empeorarlo.

create or replace function public.nombre_presentable(p_texto text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_texto, '')), '') is null then null
    when btrim(p_texto) = lower(btrim(p_texto)) or btrim(p_texto) = upper(btrim(p_texto))
      then initcap(btrim(p_texto))
    else btrim(p_texto)
  end;
$$;

comment on function public.nombre_presentable(text) is
  'Arregla nombres escritos todo en minúsculas o todo en mayúsculas; respeta los que ya traen forma.';

update public.sales_companies
set name = public.nombre_presentable(name), updated_at = now()
where name is not null
  and (btrim(name) = lower(btrim(name)) or btrim(name) = upper(btrim(name)))
  and source is not null;

update public.sales_contacts
set full_name = public.nombre_presentable(full_name), updated_at = now()
where full_name is not null
  and (btrim(full_name) = lower(btrim(full_name)) or btrim(full_name) = upper(btrim(full_name)));
