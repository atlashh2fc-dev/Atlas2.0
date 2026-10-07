-- Ajuste del clasificador de respuestas: «Confirmo, gracias» y «nos vemos»
-- también confirman, y «No hay problema» no cancela.
create or replace function public.clasificar_respuesta_cita(p_texto text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_original text := btrim(coalesce(p_texto, ''));
  v text;
begin
  if v_original = '' or length(v_original) > 80 or position('?' in v_original) > 0 or position('¿' in v_original) > 0 then
    return null;
  end if;
  -- Un pulgar o un visto solos valen como sí.
  if v_original ~ '^(👍|👌|✅|☑️|✔️|🙌|🙏|\s)+$' then
    return 'si';
  end if;
  v := translate(lower(v_original), 'áéíóúüàèìòù', 'aeiouuaeiou');
  v := btrim(regexp_replace(regexp_replace(v, '[^a-zñ0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));
  if v = '' then return null; end if;

  if v ~ '(reagend|cambiar|cambio la hora|cambiamos|mover|moverla|otra hora|otro dia|otro horario|mas tarde|mas temprano|postergar|aplazar)' then
    return 'reagendar';
  end if;
  -- «No hay problema» es un sí, no una cancelación.
  if v ~ '^(no hay problema|no problem|sin problema|ningun problema)' then
    return 'si';
  end if;
  if v ~ '^(no|nop|nope)( |$)' or v ~ '(no puedo|no podre|no voy|no vamos|no podemos|no alcanzo|no llego|cancel|anul|no asistire|no iremos)' then
    return 'no';
  end if;
  if v ~ '^(s+i+|sip|sep|ok|oki|okey|okay|oka|confirm[a-z]*|dale|listo|lista|voy|vamos|perfecto|de acuerdo|deacuerdo|claro|por supuesto|ahi estare|ahi estaremos|alli estare|asistire|asistiremos|bueno|bn|buenisimo|genial|vale|yes|ya|yap|obvio|correcto|afirmativo|nos vemos|alla nos vemos|alla estare|ahi nos vemos)( |$)' then
    return 'si';
  end if;
  return null;
end;
$$;
