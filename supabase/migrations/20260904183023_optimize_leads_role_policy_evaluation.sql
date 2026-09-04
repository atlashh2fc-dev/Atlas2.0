-- Evita evaluar ramas RLS ajenas al rol sobre cada lead. En especial, una
-- lectura masiva de supervisión no debe consultar intentos activos del agente.

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
for select to authenticated using (
  case (select public.current_role_name())
    when 'admin' then true
    when 'agente' then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
    when 'supervisor' then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
for update to authenticated using (
  case (select public.current_role_name())
    when 'admin' then true
    when 'agente' then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
    when 'supervisor' then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
) with check (
  case (select public.current_role_name())
    when 'admin' then true
    when 'agente' then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or public.has_active_dial_attempt(id)
    )
    when 'supervisor' then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
);

comment on policy leads_select on public.leads is
  'Una sola política por rol; CASE evita ejecutar búsquedas de intentos del agente durante lecturas masivas de supervisión.';
