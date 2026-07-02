
create table public.legacy_tipificacion_map (
  id uuid primary key default gen_random_uuid(),
  legacy_system text not null,
  legacy_value text not null,
  workflow_id uuid references public.workflows(id) on delete set null,
  workflow_step_id uuid references public.workflow_steps(id) on delete set null,
  mapped_result text,
  notes text,
  created_at timestamptz not null default now(),
  unique (legacy_system, legacy_value)
);

comment on table public.legacy_tipificacion_map is
  'Diccionario editable: traduce etiquetas de tipificación de un CRM legado a un paso+resultado real del workflow actual. Si workflow_step_id es null, el valor se guarda como historial informativo (interaction libre) y NO cuenta para el cálculo de workflow_compliance. Reutilizable para futuras migraciones de otros sistemas.';

alter table public.legacy_tipificacion_map enable row level security;

create policy legacy_tipificacion_map_select on public.legacy_tipificacion_map
  for select to authenticated
  using ((select current_role_name()) in ('admin','supervisor'));

create policy legacy_tipificacion_map_write on public.legacy_tipificacion_map
  for all to authenticated
  using ((select current_role_name()) = 'admin')
  with check ((select current_role_name()) = 'admin');

-- Mapeos de alta confianza (coincidencia exacta con una opción real del workflow Equifax).
-- El resto de las ~136 etiquetas legadas (DISPONIBLE_BUSQUEDA, ROJO/AMARILLO/VERDE -- scoring del
-- CRM viejo, BUZON DE VOZ, texto libre, etc.) queda deliberadamente SIN mapear: se preservan como
-- historial informativo pero no se fuerza una equivalencia que distorsione el % de cumplimiento.
insert into public.legacy_tipificacion_map (legacy_system, legacy_value, workflow_id, workflow_step_id, mapped_result) values
('equifax_crm_legado','NO CONTESTA','c62a0bf7-7669-4646-b5ce-7765d08fd546','ec99311b-b55b-46db-93c8-58058022a860','No contesta'),
('equifax_crm_legado','FUERA DE SERVICIO','c62a0bf7-7669-4646-b5ce-7765d08fd546','ec99311b-b55b-46db-93c8-58058022a860','Fuera de servicio'),
('equifax_crm_legado','VENTA','c62a0bf7-7669-4646-b5ce-7765d08fd546','47dc1b71-08b4-48d2-94c0-243c3665b169','Venta'),
('equifax_crm_legado','SE ENVIA INFORMACION','c62a0bf7-7669-4646-b5ce-7765d08fd546','22146982-235c-4b0f-a13c-8ccd4a2dbe12','SE ENVIA INFORMACION'),
('equifax_crm_legado','VOLVER A LLAMAR','c62a0bf7-7669-4646-b5ce-7765d08fd546','22146982-235c-4b0f-a13c-8ccd4a2dbe12','VOLVER A LLAMAR'),
('equifax_crm_legado','COTIZACION ENVIADA','c62a0bf7-7669-4646-b5ce-7765d08fd546','22146982-235c-4b0f-a13c-8ccd4a2dbe12','COTIZACION ENVIADA'),
('equifax_crm_legado','REUNION AGENDADA','c62a0bf7-7669-4646-b5ce-7765d08fd546','22146982-235c-4b0f-a13c-8ccd4a2dbe12','REUNION AGENDADA'),
('equifax_crm_legado','NO ES EL MOMENTO','c62a0bf7-7669-4646-b5ce-7765d08fd546','22146982-235c-4b0f-a13c-8ccd4a2dbe12','NO ES EL MOMENTO');
;
