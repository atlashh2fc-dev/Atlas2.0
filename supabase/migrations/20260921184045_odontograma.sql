-- Odontograma: el historial de cada pieza dental del paciente.
--
-- Cada fila es un hecho sobre una pieza (numeración FDI: 11-48 permanentes,
-- 51-85 temporales): lo que se encontró, en qué superficies, qué síntoma
-- refería el paciente, qué se diagnosticó y qué tratamiento se hace y en qué va.
-- No se sobreescribe: el estado de una pieza es su último registro y lo
-- anterior queda como historia, que es como lo exige una ficha de salud.
--
-- Son datos de salud (sensibles para la Ley 21.719): se leen y escriben solo
-- dentro de la empresa, por administración, supervisión o el dueño de la
-- plataforma, igual que el resto de la ficha.

create table if not exists public.odontograma_registros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  cuenta_id uuid not null references public.sales_companies(id) on delete cascade,
  pieza smallint not null,
  superficies text[] not null default '{}',
  estado text not null,
  avance text not null default 'diagnostico',
  sintoma text,
  diagnostico text,
  tratamiento text,
  profesional text,
  nota text,
  fecha date not null default ((now() at time zone 'America/Santiago')::date),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint odontograma_pieza_fdi check (
    (pieza between 11 and 18) or (pieza between 21 and 28) or (pieza between 31 and 38) or (pieza between 41 and 48)
    or (pieza between 51 and 55) or (pieza between 61 and 65) or (pieza between 71 and 75) or (pieza between 81 and 85)
  ),
  constraint odontograma_superficies_validas check (superficies <@ array['O', 'M', 'D', 'V', 'L']::text[]),
  constraint odontograma_estado_check check (estado in (
    'sano', 'caries', 'fractura', 'obturacion', 'sellante', 'endodoncia',
    'corona', 'implante', 'protesis', 'extraccion_indicada', 'ausente'
  )),
  constraint odontograma_avance_check check (avance in ('diagnostico', 'planificado', 'en_curso', 'terminado'))
);

create index if not exists odontograma_cuenta_idx on public.odontograma_registros (cuenta_id, pieza, fecha desc, created_at desc);

alter table public.odontograma_registros enable row level security;

drop policy if exists odontograma_organization_isolation on public.odontograma_registros;
create policy odontograma_organization_isolation on public.odontograma_registros
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists odontograma_select on public.odontograma_registros;
create policy odontograma_select on public.odontograma_registros
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

-- Se agrega historia; no se edita ni se borra desde la aplicación.
drop policy if exists odontograma_insert on public.odontograma_registros;
create policy odontograma_insert on public.odontograma_registros
  for insert to authenticated
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- Demo: la Clínica Dental Sonríe --------------------------------------------------
--
-- Unos pocos pacientes pasan a ser niños (5 a 11 años) para mostrar la dentición
-- temporal. El odontograma de cada paciente es coherente con su presupuesto: el
-- "Implante pieza 36" tiene la 36 ausente con el implante planificado; la
-- "Endodoncia molar 46", la 46 con caries profunda y la endodoncia en curso.

update public.sales_companies cuenta
   set metadata = cuenta.metadata || jsonb_build_object(
         'nacimiento', to_char(current_date - (1900 + floor(random() * 2200))::int, 'YYYY-MM-DD'),
         'prevision', 'Fonasa')
  from (
    select cuenta.id
    from public.sales_companies cuenta
    join public.organizations empresa on empresa.id = cuenta.organization_id and empresa.slug = 'demo-dental'
    where not exists (select 1 from public.sales_opportunities negocio where negocio.company_id = cuenta.id)
    order by cuenta.name
    limit 8
  ) ninos
 where cuenta.id = ninos.id;

do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'demo-dental');
  v_cuenta record;
  v_negocio record;
  v_nino boolean;
  v_piezas int[];
  v_pieza int;
  v_r float;
  v_fecha date;
  v_prof text;
  v_hallazgos int;
  v_k int;
  v_m int;
begin
  if v_org is null or exists (select 1 from public.odontograma_registros where organization_id = v_org) then
    return;
  end if;

  for v_cuenta in
    select cuenta.id, cuenta.created_at, cuenta.metadata
    from public.sales_companies cuenta
    where cuenta.organization_id = v_org
  loop
    v_prof := coalesce(v_cuenta.metadata ->> 'profesional', 'Dra. Paula Ríos');
    v_nino := (v_cuenta.metadata ->> 'nacimiento') is not null
              and (v_cuenta.metadata ->> 'nacimiento')::date > current_date - interval '12 years';
    v_piezas := case when v_nino
      then array[51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]
      else array[11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48] end;
    v_fecha := greatest(v_cuenta.created_at::date, current_date - 70);

    -- Historia previa: restauraciones antiguas, sellantes en niños, algún ausente.
    if not v_nino then
      for v_k in 1 .. floor(random() * 5)::int loop
        v_pieza := (array[16,17,26,27,36,37,46,47,14,15,24,25,34,35,44,45])[1 + floor(random() * 16)::int];
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, string_to_array((array['O', 'O,M', 'O,D', 'M,O,D'])[1 + floor(random() * 4)::int], ','),
                'obturacion', 'terminado', 'Caries tratada', 'Restauración de resina compuesta', v_prof,
                v_fecha - (200 + floor(random() * 900))::int, now() - interval '200 days');
      end loop;
      if random() < 0.35 then
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, estado, avance, diagnostico, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, (array[18,28,38,48])[1 + floor(random() * 4)::int], 'ausente', 'terminado',
                'Tercer molar extraído', v_prof, v_fecha - 1500, now() - interval '400 days');
      end if;
      if random() < 0.2 then
        v_pieza := (array[11,21,12,22])[1 + floor(random() * 4)::int];
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, estado, avance, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, 'corona', 'terminado', 'Fractura coronaria antigua', 'Corona de disilicato de litio', v_prof, v_fecha - 700, now() - interval '300 days');
      end if;
    else
      for v_pieza in select unnest(array[55,65,75,85]) loop
        if random() < 0.6 then
          insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, diagnostico, tratamiento, profesional, fecha, created_at)
          values (v_org, v_cuenta.id, v_pieza, array['O'], 'sellante', 'terminado', 'Fosas y fisuras profundas', 'Sellante de fosas y fisuras', v_prof, v_fecha - 180, now() - interval '180 days');
        end if;
      end loop;
    end if;

    -- Hallazgos de la evaluación actual.
    v_hallazgos := case when v_nino then 1 + floor(random() * 3)::int else floor(random() * 4)::int end;
    for v_k in 1 .. v_hallazgos loop
      v_pieza := v_piezas[1 + floor(random() * array_length(v_piezas, 1))::int];
      v_r := random();
      if v_r < 0.6 then
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, string_to_array((array['O', 'O,D', 'M', 'V'])[1 + floor(random() * 4)::int], ','),
                'caries', (array['diagnostico','planificado','en_curso'])[1 + floor(random() * 3)::int],
                (array['Sensibilidad al frío','Dolor al masticar','Sin síntomas','Sensibilidad a lo dulce'])[1 + floor(random() * 4)::int],
                (array['Caries de esmalte','Caries de dentina','Caries interproximal'])[1 + floor(random() * 3)::int],
                'Restauración de resina compuesta', v_prof, v_fecha, now() - interval '10 days');
      elsif v_r < 0.8 then
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, array['O','V'], 'fractura', 'planificado', 'Molestia al morder',
                'Fractura de cúspide', 'Restauración o incrustación', v_prof, v_fecha, now() - interval '10 days');
      else
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, array['O'], 'obturacion', 'terminado', null,
                'Caries de dentina', 'Restauración de resina compuesta', v_prof, v_fecha, now() - interval '9 days');
      end if;
    end loop;

    -- Lo que dice su presupuesto, en la pieza que corresponde.
    for v_negocio in
      select negocio.name, negocio.status from public.sales_opportunities negocio where negocio.company_id = v_cuenta.id
    loop
      v_m := nullif(substring(v_negocio.name from 'pieza ([1-4][1-8])'), '')::int;
      if v_negocio.name ilike 'Implante%' then
        v_pieza := coalesce(v_m, 36);
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, estado, avance, diagnostico, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, 'ausente', 'terminado', 'Pieza perdida', v_prof, v_fecha - 400, now() - interval '30 days');
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, 'implante',
                case v_negocio.status when 'ganada' then 'en_curso' else 'planificado' end,
                'Dificultad para masticar del lado ' || case when v_pieza % 10 >= 0 and v_pieza / 10 in (1, 4) then 'derecho' else 'izquierdo' end,
                'Edentulismo parcial', v_negocio.name, v_prof, v_fecha, now() - interval '8 days');
      elsif v_negocio.name ilike 'Endodoncia%' then
        v_pieza := coalesce(nullif(substring(v_negocio.name from 'molar ([1-4][1-8])'), '')::int, 46);
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, array['O','D'], 'caries', 'terminado', 'Dolor espontáneo nocturno',
                'Caries profunda con compromiso pulpar', 'Derivado a endodoncia', v_prof, v_fecha - 3, now() - interval '9 days');
        insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
        values (v_org, v_cuenta.id, v_pieza, array['O','D'], 'endodoncia',
                case v_negocio.status when 'ganada' then 'en_curso' else 'planificado' end,
                'Dolor espontáneo nocturno', 'Pulpitis irreversible', 'Tratamiento de conducto', v_prof, v_fecha, now() - interval '8 days');
      elsif v_negocio.name ilike '%prótesis%' then
        for v_pieza in select unnest(array[36, 37, 46]) loop
          insert into public.odontograma_registros (organization_id, cuenta_id, pieza, estado, avance, diagnostico, tratamiento, profesional, fecha, created_at)
          values (v_org, v_cuenta.id, v_pieza, 'protesis', case v_negocio.status when 'ganada' then 'en_curso' else 'planificado' end,
                  'Edentulismo parcial', 'Prótesis removible', v_prof, v_fecha, now() - interval '8 days');
        end loop;
      elsif v_negocio.name ilike '%restauraciones%' then
        for v_pieza in select unnest(array[16, 26, 36]) loop
          insert into public.odontograma_registros (organization_id, cuenta_id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, fecha, created_at)
          values (v_org, v_cuenta.id, v_pieza, array['O'], 'caries', case v_negocio.status when 'ganada' then 'en_curso' else 'planificado' end,
                  'Sensibilidad al frío', 'Caries de dentina', 'Restauración de resina compuesta', v_prof, v_fecha, now() - interval '8 days');
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;
