'use strict';

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let client = null;

if (!url || !serviceKey) {
  console.warn(
    '[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — ' +
    'stats and blocklist will run in-memory only and will NOT survive a redeploy.'
  );
} else {
  client = createClient(url, serviceKey, {
    auth: { persistSession: false }
  });
}

module.exports = client;
