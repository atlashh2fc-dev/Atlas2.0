-- Comportamiento de los reportes con historial de Atlas 1, sobre los datos de
-- reportes-historial-atlas1.sql. Cada assert_test aborta con el motivo si falla.
set timezone = 'UTC'; -- como producción: el corte de día no puede depender de la sesión

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);

create temp table resumen on commit drop as
select public.get_supervisor_report_summary(
  '2026-09-01 00:00-03', '2026-09-30 23:59-03', null, '00000000-0000-4000-8000-0000000000d1'
) as r;

select assert_test((select (r->'kpis'->>'tmo_seconds')::numeric = 90 from resumen),
  'el TMO es la nativa de 90 s: la migrada de tres días no entra');
select assert_test((select (r->'kpis'->>'llamadas_cerradas')::int = 3 and (r->'kpis'->>'llamadas_atlas1')::int = 2 from resumen),
  'la descartada no es llamada cerrada y las migradas se informan aparte');
select assert_test((select (r->'kpis'->>'crm_gestiones')::int = 3 from resumen),
  'la interacción de la llamada descartada no es gestión CRM');
select assert_test((select (r->'kpis'->>'contactados')::int = 3 from resumen),
  'la descartada connected no suma contactados');
select assert_test((select (r->'kpis'->>'ventas')::int = 1 from resumen),
  '«CLIENTE NO SUJETO A VENTA» no es una venta');
select assert_test((select (r->'kpis'->>'cotizaciones')::int = 1 from resumen),
  'la cotización escrita a mano en Atlas 1 cuenta');
select assert_test((
  select jsonb_object_agg(e->>'label', (e->>'count')::int)
    = '{"VENTA CERRADA": 1, "CLIENTE NO SUJETO A VENTA": 1, "cotización enviada": 1, "VOLVER A LLAMAR": 1}'::jsonb
  from resumen, jsonb_array_elements(r->'tipifications') e),
  'cada gestión se tipifica una vez y «connected» no aparece');
select assert_test((select jsonb_agg(e->>'day') = '["2026-09-10"]'::jsonb
  from resumen, jsonb_array_elements(r->'daily') e),
  'lo de las 22:30 de Chile cae el mismo día y no al siguiente');
select assert_test((
  select (e->>'ventas')::int = 1 and (e->>'tmo_seconds')::numeric = 90
  from resumen, jsonb_array_elements(r->'agents') e
  where e->>'profile_id' = '00000000-0000-4000-8000-0000000000c3'),
  'la ejecutiva ve su venta real y su TMO real');

select assert_test((
  select jsonb_array_length(public.get_supervisor_report_drilldown(
    '2026-09-01 00:00-03', '2026-09-30 23:59-03', '00000000-0000-4000-8000-0000000000c3', null, 'ventas', 100,
    '00000000-0000-4000-8000-0000000000d1')->'items') = 1),
  'el detalle de ventas lista solo la venta declarada');
select assert_test((
  select public.get_supervisor_report_drilldown(
    '2026-09-01 00:00-03', '2026-09-30 23:59-03', '00000000-0000-4000-8000-0000000000c3', null, 'cotizaciones', 100,
    '00000000-0000-4000-8000-0000000000d1')->'items'->0->>'call_id' = '00000000-0000-4000-8000-0000000000f4'),
  'el detalle de cotizaciones usa la misma regla que el resumen');

select assert_test((
  select managements_today = 2 and effective_contacts_today = 1 and sales_today = 1
  from public.get_queue_health() where campaign_id = '00000000-0000-4000-8000-0000000000d2'),
  'la salud de cola cuenta solo lo gestionado hoy en Atlas 2.0');

-- Alcance del supervisor: el suyo ve lo mismo; el de otro equipo, nada.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', true);
select assert_test((
  select (public.get_supervisor_report_summary('2026-09-01 00:00-03', '2026-09-30 23:59-03', null,
    '00000000-0000-4000-8000-0000000000d1')->'kpis'->>'crm_gestiones')::int = 3),
  'la supervisora del equipo ve las gestiones de su equipo');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c4', true);
select assert_test((
  select (public.get_supervisor_report_summary('2026-09-01 00:00-03', '2026-09-30 23:59-03', null,
    '00000000-0000-4000-8000-0000000000d1')->'kpis'->>'llamadas_cerradas')::int = 0),
  'un supervisor de otro equipo no ve esas llamadas');
do $$
begin
  perform public.get_supervisor_report_summary('2026-09-01 00:00-03', '2026-09-30 23:59-03',
    '00000000-0000-4000-8000-0000000000b1', null);
  raise exception 'FALLA: un supervisor pidió un equipo ajeno y no se le negó';
exception when others then
  if sqlerrm not like '%fuera de tu alcance%' then raise; end if;
  raise notice 'ok: un supervisor no puede pedir un equipo ajeno';
end
$$;
commit;

-- Tablas precalculadas (las alimentan triggers, sin sesión de usuario). Siguen
-- cortando el día en UTC: la venta de las 22:30 de Chile cae el 11.
select public.refresh_supervisor_report_agent_metric_row(d, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3')
from unnest(array['2026-09-10'::date, '2026-09-11'::date]) d;
select public.refresh_supervisor_report_agent_tipification_rows(d, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3')
from unnest(array['2026-09-10'::date, '2026-09-11'::date]) d;
select public.refresh_supervisor_report_tipification_rows(d, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3')
from unnest(array['2026-09-10'::date, '2026-09-11'::date]) d;

select assert_test((
  select ventas = 0 and cotizaciones = 1 and llamadas_cerradas = 2 and crm_gestiones = 2 and tmo_count = 0
  from public.supervisor_report_daily_agent_metrics where metric_day = '2026-09-10'),
  'precalculado del 10: sin venta falsa, sin TMO migrado, sin la descartada');
select assert_test((
  select ventas = 1 and tmo_count = 1 and tmo_sum_seconds = 90
  from public.supervisor_report_daily_agent_metrics where metric_day = '2026-09-11'),
  'precalculado del 11: la venta real con su TMO');
select assert_test((
  select jsonb_object_agg(metric_day || ' ' || label, count)
    = '{"2026-09-10 CLIENTE NO SUJETO A VENTA": 1, "2026-09-10 cotización enviada": 1, "2026-09-10 VOLVER A LLAMAR": 1, "2026-09-11 VENTA CERRADA": 1}'::jsonb
  from public.supervisor_report_daily_agent_tipifications),
  'tipificaciones precalculadas por ejecutivo: una por gestión y sin «connected»');
select assert_test((
  select jsonb_object_agg(metric_day || ' ' || label, count)
    = '{"2026-09-10 CLIENTE NO SUJETO A VENTA": 1, "2026-09-10 cotización enviada": 1, "2026-09-10 VOLVER A LLAMAR": 1, "2026-09-11 VENTA CERRADA": 1}'::jsonb
  from public.supervisor_report_daily_tipifications),
  'tipificaciones precalculadas por agente: una por gestión y sin «connected»');
