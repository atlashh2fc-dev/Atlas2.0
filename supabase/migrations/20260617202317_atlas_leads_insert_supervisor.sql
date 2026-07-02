
drop policy leads_insert_admin on public.leads;

create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.current_role_name() = 'admin'
    or (
      public.current_role_name() = 'supervisor'
      and (team_id is null or team_id = public.current_team_id())
    )
  );
;
