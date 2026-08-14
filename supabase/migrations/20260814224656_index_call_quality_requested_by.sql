create index if not exists call_quality_evaluations_requested_by_idx
  on public.call_quality_evaluations (requested_by)
  where requested_by is not null;
