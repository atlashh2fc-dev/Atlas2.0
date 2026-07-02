drop policy if exists crm_entities_select on public.crm_entities;

create policy crm_entities_select
on public.crm_entities
for select
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.crm_entity_id = crm_entities.id
  )
);
