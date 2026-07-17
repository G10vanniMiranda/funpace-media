begin;

create table if not exists public.integrity_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('audit', 'reconcile')),
  trigger_source text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  code_version text,
  configuration jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.integrity_findings (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  run_id uuid references public.integrity_runs(id) on delete set null,
  category text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  entity_type text not null,
  entity_id text,
  confidence numeric(5, 2) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  proposed_change jsonb,
  status text not null default 'open' check (status in ('open', 'review', 'auto_fixed', 'resolved', 'ignored')),
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.integrity_review_queue (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null unique references public.integrity_findings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'corrected')),
  proposal jsonb not null default '{}'::jsonb,
  reviewer_id text,
  reviewer_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  corrected_at timestamptz
);

create table if not exists public.integrity_audit_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.integrity_runs(id) on delete set null,
  finding_id uuid references public.integrity_findings(id) on delete set null,
  actor_id text,
  worker text not null,
  service text not null,
  entity_type text not null,
  entity_id text,
  field_name text not null,
  value_before jsonb,
  value_after jsonb,
  reason text not null,
  confidence numeric(5, 2) not null,
  decision_origin text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.integrity_metrics (
  id bigint generated always as identity primary key,
  run_id uuid references public.integrity_runs(id) on delete set null,
  metric_name text not null,
  metric_value numeric not null,
  labels jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists public.integrity_alert_rules (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null unique,
  operator text not null default 'gt' check (operator in ('gt', 'gte', 'lt', 'lte')),
  threshold numeric not null,
  severity text not null default 'warning' check (severity in ('warning', 'critical')),
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 1 and 10080),
  enabled boolean not null default true,
  channels jsonb not null default '["log"]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.integrity_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.integrity_alert_rules(id) on delete set null,
  run_id uuid references public.integrity_runs(id) on delete set null,
  metric_name text not null,
  metric_value numeric not null,
  threshold numeric not null,
  severity text not null,
  status text not null default 'open' check (status in ('open', 'sent', 'acknowledged', 'resolved', 'failed')),
  channels jsonb not null default '[]'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz
);

create index if not exists integrity_runs_started_idx on public.integrity_runs(started_at desc);
create index if not exists integrity_findings_status_idx on public.integrity_findings(status, severity, last_seen_at desc);
create index if not exists integrity_findings_entity_idx on public.integrity_findings(entity_type, entity_id);
create index if not exists integrity_review_status_idx on public.integrity_review_queue(status, created_at desc);
create index if not exists integrity_metrics_name_time_idx on public.integrity_metrics(metric_name, captured_at desc);
create index if not exists integrity_alerts_status_idx on public.integrity_alerts(status, created_at desc);
create index if not exists integrity_audit_created_idx on public.integrity_audit_logs(created_at desc);

insert into public.integrity_alert_rules(metric_name, operator, threshold, severity, cooldown_minutes, channels)
values
  ('face_pending', 'gt', 25, 'warning', 30, '["log"]'),
  ('face_processing_stuck', 'gt', 0, 'critical', 15, '["log"]'),
  ('aws_orphan_faces', 'gt', 0, 'warning', 60, '["log"]'),
  ('integrity_critical_findings', 'gt', 0, 'critical', 30, '["log"]'),
  ('review_queue_pending', 'gt', 100, 'warning', 120, '["log"]'),
  ('face_failed', 'gt', 10, 'warning', 60, '["log"]')
on conflict (metric_name) do nothing;

alter table public.integrity_runs enable row level security;
alter table public.integrity_findings enable row level security;
alter table public.integrity_review_queue enable row level security;
alter table public.integrity_audit_logs enable row level security;
alter table public.integrity_metrics enable row level security;
alter table public.integrity_alert_rules enable row level security;
alter table public.integrity_alerts enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['integrity_runs','integrity_findings','integrity_review_queue','integrity_audit_logs','integrity_metrics','integrity_alert_rules','integrity_alerts']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_all', table_name);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', table_name || '_admin_all', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

grant usage, select on sequence public.integrity_metrics_id_seq to service_role;

commit;
