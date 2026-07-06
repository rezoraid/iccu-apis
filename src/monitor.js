'use strict';

const supabase = require('./supabaseClient');

const MAX_LOG = 200;
const FLUSH_INTERVAL_MS = 15_000; // batch-write to Supabase every 15s

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// ---- in-memory state (fast path, always authoritative for "right now") ----
const state = {
  blockedIps: new Set(),
  log: [],
  totals: new Map(),   // path -> count
  perIp: new Map(),     // ip -> count

  // running totals, kept in memory and periodically flushed
  totalAllTime: 0,
  blockedAllTime: 0,
  day: todayUTC(),
  totalToday: 0,
  blockedToday: 0,
  errors5xxToday: 0,

  // dirty deltas waiting to be flushed to Supabase
  pendingTotalDelta: 0,
  pendingBlockedDelta: 0,
  pendingDayTotalDelta: 0,
  pendingDayBlockedDelta: 0,
  pendingDay5xxDelta: 0,
  pendingIpBlockHits: new Map() // ip -> count of blocked hits since last flush
};

let ready = false;

// ---- startup: hydrate memory from Supabase so restarts don't lose data ----
async function init() {
  if (!supabase) {
    ready = true;
    return;
  }

  try {
    const { data: blocked, error: blockedErr } = await supabase
      .from('blocked_ips')
      .select('ip, blocked')
      .eq('blocked', true);
    if (blockedErr) throw blockedErr;
    (blocked || []).forEach((row) => state.blockedIps.add(row.ip));

    const { data: totals, error: totalsErr } = await supabase
      .from('request_stats_total')
      .select('total_requests, blocked_requests')
      .eq('id', 1)
      .maybeSingle();
    if (totalsErr) throw totalsErr;
    if (totals) {
      state.totalAllTime = Number(totals.total_requests) || 0;
      state.blockedAllTime = Number(totals.blocked_requests) || 0;
    }

    const day = todayUTC();
    const { data: dayRow, error: dayErr } = await supabase
      .from('request_stats_daily')
      .select('total_requests, blocked_requests, errors_5xx')
      .eq('day', day)
      .maybeSingle();
    if (dayErr) throw dayErr;
    if (dayRow) {
      state.totalToday = Number(dayRow.total_requests) || 0;
      state.blockedToday = Number(dayRow.blocked_requests) || 0;
      state.errors5xxToday = Number(dayRow.errors_5xx) || 0;
    }

    console.log(
      `[monitor] hydrated from Supabase: ${state.blockedIps.size} blocked IP(s), ` +
      `${state.totalAllTime} total requests all-time`
    );
  } catch (err) {
    console.error('[monitor] failed to hydrate from Supabase:', err.message);
  } finally {
    ready = true;
  }
}

function rolloverDayIfNeeded() {
  const day = todayUTC();
  if (day !== state.day) {
    // flush whatever is pending for the old day before resetting
    flush().finally(() => {
      state.day = day;
      state.totalToday = 0;
      state.blockedToday = 0;
      state.errors5xxToday = 0;
    });
  }
}

function recordRequest({ ip, method, path, status, ms }) {
  rolloverDayIfNeeded();

  const entry = { ip, method, path, status, ms, at: new Date().toISOString() };
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.shift();

  state.totals.set(path, (state.totals.get(path) || 0) + 1);
  state.perIp.set(ip, (state.perIp.get(ip) || 0) + 1);

  state.totalAllTime += 1;
  state.totalToday += 1;
  state.pendingTotalDelta += 1;
  state.pendingDayTotalDelta += 1;

  if (status >= 500) {
    state.errors5xxToday += 1;
    state.pendingDay5xxDelta += 1;
  }
}

// Called from the "blocked" middleware path — a request that never even
// reaches the normal recordRequest handler because it was rejected outright.
function recordBlockedHit(ip) {
  rolloverDayIfNeeded();

  state.blockedAllTime += 1;
  state.blockedToday += 1;
  state.pendingBlockedDelta += 1;
  state.pendingDayBlockedDelta += 1;
  state.pendingIpBlockHits.set(ip, (state.pendingIpBlockHits.get(ip) || 0) + 1);
}

function isBlocked(ip) {
  return state.blockedIps.has(ip);
}

async function blockIp(ip) {
  state.blockedIps.add(ip);
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('blocked_ips')
      .upsert(
        {
          ip,
          blocked: true,
          last_blocked_at: new Date().toISOString()
        },
        { onConflict: 'ip' }
      );
    if (error) throw error;
  } catch (err) {
    console.error('[monitor] failed to persist blockIp:', err.message);
  }
}

async function unblockIp(ip) {
  const removed = state.blockedIps.delete(ip);
  if (!supabase) return removed;
  try {
    const { error } = await supabase
      .from('blocked_ips')
      .update({ blocked: false })
      .eq('ip', ip);
    if (error) throw error;
  } catch (err) {
    console.error('[monitor] failed to persist unblockIp:', err.message);
  }
  return removed;
}

function listBlocked() {
  return [...state.blockedIps];
}

function recentLog(limit = 20) {
  return state.log.slice(-limit).reverse();
}

function topEndpoints(limit = 10) {
  return [...state.totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, count]) => ({ path, count }));
}

function topIps(limit = 10) {
  return [...state.perIp.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, count]) => ({ ip, count, blocked: isBlocked(ip) }));
}

// Real-time snapshot — always served from memory, never blocks on a DB call.
function stats() {
  return {
    ready,
    today: {
      day: state.day,
      totalRequests: state.totalToday,
      blockedRequests: state.blockedToday,
      errors5xx: state.errors5xxToday
    },
    allTime: {
      totalRequests: state.totalAllTime,
      blockedRequests: state.blockedAllTime
    },
    blockedIpCount: state.blockedIps.size
  };
}

function totalRequests() {
  return state.totalAllTime;
}

// ---- periodic flush: push accumulated deltas to Supabase in batches ----
async function flush() {
  if (!supabase) return;

  const totalDelta = state.pendingTotalDelta;
  const blockedDelta = state.pendingBlockedDelta;
  const dayTotalDelta = state.pendingDayTotalDelta;
  const dayBlockedDelta = state.pendingDayBlockedDelta;
  const day5xxDelta = state.pendingDay5xxDelta;
  const ipHits = state.pendingIpBlockHits;

  if (
    totalDelta === 0 &&
    blockedDelta === 0 &&
    dayTotalDelta === 0 &&
    dayBlockedDelta === 0 &&
    day5xxDelta === 0 &&
    ipHits.size === 0
  ) {
    return; // nothing to do, skip the round trip
  }

  // reset pending counters immediately so new requests accumulate fresh deltas
  state.pendingTotalDelta = 0;
  state.pendingBlockedDelta = 0;
  state.pendingDayTotalDelta = 0;
  state.pendingDayBlockedDelta = 0;
  state.pendingDay5xxDelta = 0;
  state.pendingIpBlockHits = new Map();

  try {
    if (totalDelta !== 0 || blockedDelta !== 0) {
      const { error } = await supabase.rpc('increment_request_totals', {
        p_total_delta: totalDelta,
        p_blocked_delta: blockedDelta
      });
      if (error) throw error;
    }

    if (dayTotalDelta !== 0 || dayBlockedDelta !== 0 || day5xxDelta !== 0) {
      const { error } = await supabase.rpc('increment_daily_stats', {
        p_day: state.day,
        p_total_delta: dayTotalDelta,
        p_blocked_delta: dayBlockedDelta,
        p_5xx_delta: day5xxDelta
      });
      if (error) throw error;
    }

    for (const [ip, hits] of ipHits.entries()) {
      const { error } = await supabase.rpc('increment_blocked_ip_hits', {
        p_ip: ip,
        p_hits: hits
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error('[monitor] flush to Supabase failed, re-queuing deltas:', err.message);
    // put the deltas back so we retry on the next tick instead of losing them
    state.pendingTotalDelta += totalDelta;
    state.pendingBlockedDelta += blockedDelta;
    state.pendingDayTotalDelta += dayTotalDelta;
    state.pendingDayBlockedDelta += dayBlockedDelta;
    state.pendingDay5xxDelta += day5xxDelta;
    for (const [ip, hits] of ipHits.entries()) {
      state.pendingIpBlockHits.set(ip, (state.pendingIpBlockHits.get(ip) || 0) + hits);
    }
  }
}

let flushTimer = null;
function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  flushTimer.unref(); // don't keep the process alive just for this
}

// kick things off
init().then(startFlushLoop);

// best-effort flush on shutdown so the last few seconds aren't lost
process.on('SIGTERM', () => flush().finally(() => process.exit(0)));
process.on('SIGINT', () => flush().finally(() => process.exit(0)));

module.exports = {
  recordRequest,
  recordBlockedHit,
  isBlocked,
  blockIp,
  unblockIp,
  listBlocked,
  recentLog,
  topEndpoints,
  topIps,
  totalRequests,
  stats
};
