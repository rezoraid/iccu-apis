-- =====================================================
-- Gateway API — Supabase schema
-- Run this once in Supabase SQL editor (Dashboard > SQL Editor > New query)
-- =====================================================

-- 1) Blocked IPs: persists the blocklist itself + how many requests
--    from that IP were rejected because it was blocked.
create table if not exists blocked_ips (
  ip text primary key,
  blocked boolean not null default true,
  blocked_request_count bigint not null default 0,
  first_blocked_at timestamptz not null default now(),
  last_blocked_at timestamptz not null default now()
);

-- 2) Daily aggregate stats: one row per calendar day (UTC).
--    This is what makes "requests today" instant — we never
--    count raw log rows, we just increment counters.
create table if not exists request_stats_daily (
  day date primary key,
  total_requests bigint not null default 0,
  blocked_requests bigint not null default 0,
  errors_5xx bigint not null default 0
);

-- 3) All-time totals: single row, avoids ever summing the whole table.
create table if not exists request_stats_total (
  id smallint primary key default 1,
  total_requests bigint not null default 0,
  blocked_requests bigint not null default 0,
  constraint single_row check (id = 1)
);

insert into request_stats_total (id, total_requests, blocked_requests)
values (1, 0, 0)
on conflict (id) do nothing;

-- Helpful index for querying recent days if you build a chart later
create index if not exists idx_request_stats_daily_day on request_stats_daily (day desc);

-- Row Level Security: lock these tables down since only your server
-- (using the service_role key) should read/write them.
alter table blocked_ips enable row level security;
alter table request_stats_daily enable row level security;
alter table request_stats_total enable row level security;

-- No policies are created on purpose — service_role bypasses RLS entirely,
-- and your server is the only thing that will ever hold that key.

-- =====================================================
-- RPC functions: atomic increments so batched writes from
-- the server never race each other or lose counts.
-- =====================================================

create or replace function increment_request_totals(
  p_total_delta bigint,
  p_blocked_delta bigint
) returns void as $$
begin
  update request_stats_total
  set total_requests = total_requests + p_total_delta,
      blocked_requests = blocked_requests + p_blocked_delta
  where id = 1;
end;
$$ language plpgsql;

create or replace function increment_daily_stats(
  p_day date,
  p_total_delta bigint,
  p_blocked_delta bigint,
  p_5xx_delta bigint
) returns void as $$
begin
  insert into request_stats_daily (day, total_requests, blocked_requests, errors_5xx)
  values (p_day, p_total_delta, p_blocked_delta, p_5xx_delta)
  on conflict (day) do update
  set total_requests = request_stats_daily.total_requests + excluded.total_requests,
      blocked_requests = request_stats_daily.blocked_requests + excluded.blocked_requests,
      errors_5xx = request_stats_daily.errors_5xx + excluded.errors_5xx;
end;
$$ language plpgsql;

create or replace function increment_blocked_ip_hits(
  p_ip text,
  p_hits bigint
) returns void as $$
begin
  insert into blocked_ips (ip, blocked, blocked_request_count, first_blocked_at, last_blocked_at)
  values (p_ip, true, p_hits, now(), now())
  on conflict (ip) do update
  set blocked_request_count = blocked_ips.blocked_request_count + excluded.blocked_request_count,
      last_blocked_at = now();
end;
$$ language plpgsql;
