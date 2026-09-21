-- En las clínicas demo, todo paciente registrado tiene su ficha, tenga o no
-- presupuesto: la lista de Pacientes parte de la ficha, no del presupuesto.
with sin_ficha as (
  select lead.*
  from public.leads lead
  join public.organizations empresa on empresa.id = lead.organization_id and empresa.slug in ('demo-dental', 'demo-vet')
  where not exists (select 1 from public.sales_contacts contacto where contacto.lead_id = lead.id)
), cuentas as (
  insert into public.sales_companies (organization_id, name, phone, email, commune, region, source, owner_id, metadata, created_at)
  select organization_id, full_name, phone, email,
         (array['Providencia','Ñuñoa','Las Condes','Santiago','La Reina','Macul'])[1 + floor(random() * 6)::int],
         'Metropolitana', (array['instagram','google','referido','whatsapp'])[1 + floor(random() * 4)::int],
         assigned_to, coalesce(extra, '{}'::jsonb), created_at
  from sin_ficha
  returning id, organization_id, name, phone, email, created_at
)
insert into public.sales_contacts (organization_id, company_id, full_name, email, phone, whatsapp, lead_id, is_decision_maker)
select cuenta.organization_id, cuenta.id, cuenta.name, cuenta.email, cuenta.phone, cuenta.phone,
       (select lead.id from sin_ficha lead where lead.organization_id = cuenta.organization_id and lead.full_name = cuenta.name
          and lead.created_at = cuenta.created_at limit 1), true
from cuentas cuenta;

insert into public.mascotas (organization_id, cuenta_id, nombre, especie, raza, sexo, nacimiento, peso_kg, esterilizado, ultima_vacuna, proxima_vacuna)
select cuenta.organization_id, cuenta.id, cuenta.metadata ->> 'mascota', cuenta.metadata ->> 'especie', cuenta.metadata ->> 'raza',
       case when random() < 0.5 then 'Macho' else 'Hembra' end, current_date - (365 + floor(random() * 3650))::int,
       case when cuenta.metadata ->> 'especie' = 'Gato' then round((3 + random() * 3)::numeric, 1) else round((5 + random() * 28)::numeric, 1) end,
       random() < 0.6, vacuna - 365, vacuna
from public.sales_companies cuenta
join public.organizations empresa on empresa.id = cuenta.organization_id and empresa.slug = 'demo-vet'
cross join lateral (select current_date + (floor(random() * 120) - 40)::int as vacuna) fecha
where cuenta.metadata ? 'mascota'
  and not exists (select 1 from public.mascotas m where m.cuenta_id = cuenta.id);

update public.sales_companies cuenta
   set metadata = cuenta.metadata || jsonb_build_object('nacimiento', to_char(current_date - (6570 + floor(random() * 18250))::int, 'YYYY-MM-DD'))
  from public.organizations empresa
 where empresa.id = cuenta.organization_id and empresa.slug = 'demo-dental'
   and not cuenta.metadata ? 'nacimiento';
