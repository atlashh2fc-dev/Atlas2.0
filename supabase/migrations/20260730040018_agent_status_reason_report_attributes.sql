-- Los estados de agente definían el cálculo de adherencia sin declararlo: la
-- exclusión estaba escrita a mano como `code <> 'desconectado'` dentro del
-- reporte. Ahora es un atributo del estado y se puede configurar.
alter table public.agent_status_reasons
  add column if not exists is_productive boolean not null default false,
  add column if not exists excludes_from_adherence boolean not null default false,
  add column if not exists max_seconds integer;

comment on column public.agent_status_reasons.is_productive is 'El tiempo en este estado cuenta como trabajo efectivo.';
comment on column public.agent_status_reasons.excludes_from_adherence is 'El tiempo en este estado no entra en el cálculo de adherencia (p. ej. desconexiones).';
comment on column public.agent_status_reasons.max_seconds is 'Tope sugerido de permanencia, en segundos. Nulo = sin tope.';

-- Estado inicial equivalente al comportamiento anterior del reporte.
update public.agent_status_reasons
   set excludes_from_adherence = true
 where code = 'desconectado' or is_system = true;

update public.agent_status_reasons
   set is_productive = true
 where is_pause = false and is_system = false;
