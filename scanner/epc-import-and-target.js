/**
 * epc-import-and-target.js
 *
 * Three modes:
 *   node epc-import-and-target.js --setup
 *     → Checks Supabase for required tables and creates any that are missing
 *
 *   node epc-import-and-target.js --import path/to/certificates.csv
 *     → Parses EPC CSV, matches to property_key, upserts to epc_data table
 *
 *   node epc-import-and-target.js --target
 *     → Cross-references recent EPCs with market events (reduced/withdrawn/sold_stc)
 *       and writes a mailing list to BOTH a CSV file AND Supabase mailing_targets table
 *
 *   Combine any flags in one run:
 *   node epc-import-and-target.js --setup --import certificates.csv --target
 */

const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yeogknaswgithbmpcozu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inllb2drbmFzd2dpdGhibXBjb3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNzkxMzcsImV4cCI6MjA4NTg1NTEzN30.sS_76s17DLrd2NXyWwzCyolxH-kaomgANjsPZDyaAC8';
const SB_API   = `${SUPABASE_URL}/rest/v1`;
const SB_RPC   = `${SUPABASE_URL}/rest/v1/rpc`;

const SB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
  'Prefer':        'resolution=merge-duplicates',
};

// ── Targeting config — tweak these without touching anything else ──
const TARGET_CONFIG = {
  epc_max_age_months: 18,       // Only use EPCs lodged in last N months
  min_price:          0,        // 0 = no minimum
  max_price:          99999999, // 99999999 = no maximum
  market_events:      ['price_reduced', 'withdrawn', 'sold_stc'],
  output_file:        `cv-mailing-list-${new Date().toISOString().split('T')[0]}.csv`,
};

// ============================================================
// SQL DEFINITIONS — tables we need
// ============================================================
const TABLE_SQL = {
  epc_data: `
    CREATE TABLE IF NOT EXISTS epc_data (
      id                       bigserial PRIMARY KEY,
      property_key             text,
      address                  text,
      postcode                 text,
      lodgement_date           date,
      current_energy_rating    text,
      potential_energy_rating  text,
      property_type            text,
      built_form               text,
      total_floor_area         numeric,
      number_habitable_rooms   int,
      tenure                   text,
      lmk_key                  text UNIQUE,
      created_at               timestamptz DEFAULT now(),
      updated_at               timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS epc_data_property_key_idx  ON epc_data(property_key);
    CREATE INDEX IF NOT EXISTS epc_data_postcode_idx      ON epc_data(postcode);
    CREATE INDEX IF NOT EXISTS epc_data_lodgement_date_idx ON epc_data(lodgement_date);
  `,

  mailing_targets: `
    CREATE TABLE IF NOT EXISTS mailing_targets (
      id                  bigserial PRIMARY KEY,
      property_key        text,
      full_address        text,
      postcode            text,
      event_type          text,
      event_description   text,
      asking_price        int,
      agent               text,
      event_date          date,
      epc_rating          text,
      epc_potential       text,
      epc_lodged          date,
      epc_property_type   text,
      epc_floor_area_sqm  numeric,
      db_property_type    text,
      tenure              text,
      mailed              boolean DEFAULT false,
      mailed_at           timestamptz,
      batch_date          date,
      created_at          timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mailing_targets_property_key_idx ON mailing_targets(property_key);
    CREATE INDEX IF NOT EXISTS mailing_targets_batch_date_idx    ON mailing_targets(batch_date);
    CREATE INDEX IF NOT EXISTS mailing_targets_mailed_idx        ON mailing_targets(mailed);
    CREATE INDEX IF NOT EXISTS mailing_targets_event_type_idx    ON mailing_targets(event_type);
  `,
};

// ============================================================
// HELPERS
// ============================================================
function norm(s) {
  return (s || '').toUpperCase().trim().replace(/[.,]+$/, '').replace(/\s+/g, ' ');
}

function extractStreetFromAddress(address) {
  const addr = norm(address);
  const parts = addr.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const first = parts[0];
    if (/^\d+[A-Z]?$/.test(first)) return parts.slice(1).join(' ').trim();
    if (/^(FLAT|UNIT|APARTMENT|ROOM)\s/i.test(first)) return parts.slice(1).join(' ').trim();
    return parts[parts.length - 1].trim();
  }
  return addr;
}

function buildingMatches(dbAddress, epcNum, epcName) {
  const db = norm(dbAddress);
  if (epcNum) {
    const n = norm(epcNum);
    if (db.startsWith(n + ' ') || db.includes(', ' + n + ' ') ||
        db.includes(' ' + n + ' ') || db.includes(' ' + n + ',')) return true;
    if (db.match(new RegExp(`\\b${n}[A-Z]?\\b`))) return true;
  }
  if (epcName && db.includes(norm(epcName))) return true;
  return false;
}

// Parse the EPC government CSV (handles quoted fields)
async function parseEpcCsv(filePath) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let headers = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    // Split respecting quoted commas
    const cols = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());

    if (!headers) {
      headers = cols.map(h => h.toLowerCase().replace(/[\s\-]+/g, '_'));
      continue;
    }
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    records.push(row);
  }

  console.log(`  Parsed ${records.length.toLocaleString()} EPC records`);
  return records;
}

// ============================================================
// SUPABASE — generic helpers
// ============================================================
async function tableExists(tableName) {
  const res = await fetch(
    `${SB_API}/${tableName}?limit=1`,
    { headers: SB_HEADERS }
  );
  return res.status !== 404;
}

async function runSql(sql) {
  // Uses the Supabase SQL API via pg_dump — requires service role key for DDL.
  // If anon key doesn't have CREATE TABLE rights, log instructions instead.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ query: sql }),
  });
  return res.ok;
}

async function sbPost(table, rows, upsert = true) {
  if (rows.length === 0) return 0;
  let success = 0;
  const headers = {
    ...SB_HEADERS,
    'Prefer': upsert ? 'resolution=merge-duplicates' : 'return=minimal',
  };
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    try {
      const res = await fetch(`${SB_API}/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
      });
      if (res.ok) {
        success += batch.length;
      } else {
        const err = await res.text();
        console.warn(`  ⚠ ${table} batch error: ${err.substring(0, 300)}`);
      }
    } catch (e) {
      console.warn(`  ⚠ ${table} network error: ${e.message}`);
    }
  }
  return success;
}

async function fetchAllProperties() {
  console.log('Fetching properties from Supabase...');
  let all = [], offset = 0;
  while (true) {
    const res = await fetch(
      `${SB_API}/properties?select=property_key,address,postcode&offset=${offset}&limit=1000&order=property_key`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
    const batch = await res.json();
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    offset += 1000;
    if (offset % 20000 === 0) process.stdout.write(`  ${all.length.toLocaleString()} rows...\n`);
  }
  console.log(`  Fetched ${all.length.toLocaleString()} properties`);
  return all;
}

function buildPropertyIndex(properties) {
  const index = {};
  for (const p of properties) {
    const pc = (p.postcode || '').toUpperCase().trim();
    if (!pc) continue;
    const street = norm(extractStreetFromAddress(p.address));
    if (!street) continue;
    if (!index[pc]) index[pc] = {};
    if (!index[pc][street]) index[pc][street] = [];
    index[pc][street].push({ property_key: p.property_key, address: p.address || '' });
  }
  return index;
}

function matchEpcToProperty(epcRow, propertyIndex) {
  const pc = (epcRow.postcode || '').toUpperCase().trim();
  // EPC CSVs use address1 / address2 / address3 columns
  const addr = [epcRow.address1, epcRow.address2].filter(Boolean).join(', ') || epcRow.address || '';
  const street = norm(extractStreetFromAddress(addr));

  if (!pc || !street || !propertyIndex[pc]) return null;

  let candidates = propertyIndex[pc][street];
  if (!candidates) {
    for (const [s, entries] of Object.entries(propertyIndex[pc])) {
      if (s.includes(street) || street.includes(s)) { candidates = entries; break; }
    }
  }
  if (!candidates || candidates.length === 0) return null;

  const firstToken = (addr.trim().split(/[\s,]+/)[0] || '');
  const epcNum  = /^\d+[A-Z]?$/.test(firstToken) ? firstToken : '';
  const epcName = !epcNum ? firstToken : '';

  if (epcNum || epcName) {
    const precise = candidates.filter(c => buildingMatches(c.address, epcNum, epcName));
    if (precise.length > 0) return { ...precise[0], matchType: 'exact' };
  }
  return { ...candidates[0], matchType: 'street' };
}

// ============================================================
// --setup MODE
// ============================================================
async function runSetup() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log('  TABLE SETUP CHECK');
  console.log(`${'═'.repeat(55)}\n`);

  for (const [tableName, sql] of Object.entries(TABLE_SQL)) {
    process.stdout.write(`  Checking ${tableName}... `);
    const exists = await tableExists(tableName);

    if (exists) {
      console.log('✓ exists');
    } else {
      console.log('✗ not found — attempting to create...');
      // Try via RPC exec_sql (requires a SQL function to be set up, or service role)
      const ok = await runSql(sql);
      if (ok) {
        console.log(`    ✓ ${tableName} created`);
      } else {
        // RPC not available with anon key — print SQL for manual run
        console.log(`\n  ⚠ Could not auto-create ${tableName}.`);
        console.log('  Please run the following SQL in your Supabase SQL editor:\n');
        console.log('  ─────────────────────────────────────────────────────────');
        console.log(sql.trim().split('\n').map(l => '  ' + l).join('\n'));
        console.log('  ─────────────────────────────────────────────────────────\n');
      }
    }
  }
  console.log('');
}

// ============================================================
// --import MODE
// ============================================================
async function runImport(csvPath) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  EPC IMPORT — ${path.basename(csvPath)}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`  ✗ File not found: ${csvPath}`); process.exit(1);
  }

  // Warn if table might not exist
  const exists = await tableExists('epc_data');
  if (!exists) {
    console.warn('  ⚠ epc_data table not found — run --setup first or create it manually.');
    console.warn('  Continuing anyway in case it exists under a different schema...\n');
  }

  const records   = await parseEpcCsv(csvPath);
  const properties = await fetchAllProperties();
  const index     = buildPropertyIndex(properties);

  console.log('\nMatching EPC records to properties...');
  let matched = 0, unmatched = 0, exactCount = 0, streetCount = 0;
  const epcRows = [];

  for (const r of records) {
    const match = matchEpcToProperty(r, index);
    const lodgementDate = r.lodgement_date || r.lodgement_datetime?.split(' ')[0] || null;

    epcRows.push({
      property_key:            match?.property_key || null,
      address:                 [r.address1, r.address2, r.address3].filter(Boolean).join(', ') || r.address || '',
      postcode:                (r.postcode || '').toUpperCase().trim(),
      lodgement_date:          lodgementDate || null,
      current_energy_rating:   r.current_energy_rating || null,
      potential_energy_rating: r.potential_energy_rating || null,
      property_type:           r.property_type || null,
      built_form:              r.built_form || null,
      total_floor_area:        parseFloat(r.total_floor_area) || null,
      number_habitable_rooms:  parseInt(r.number_habitable_rooms) || null,
      tenure:                  r.tenure || null,
      lmk_key:                 r.lmk_key || null,
      updated_at:              new Date().toISOString(),
    });

    if (match) {
      matched++;
      match.matchType === 'exact' ? exactCount++ : streetCount++;
    } else {
      unmatched++;
    }

    if (epcRows.length % 5000 === 0) {
      process.stdout.write(`  Processed ${epcRows.length.toLocaleString()}...\r`);
    }
  }

  console.log(`\n  Matched:   ${matched.toLocaleString()} (${exactCount} exact, ${streetCount} street-level)`);
  console.log(`  Unmatched: ${unmatched.toLocaleString()} (stored without property_key — can still be queried by postcode)`);

  console.log('\nUpserting to Supabase epc_data...');
  const ok = await sbPost('epc_data', epcRows, true);
  console.log(`  ✓ ${ok.toLocaleString()}/${epcRows.length.toLocaleString()} rows upserted`);
}

// ============================================================
// --target MODE
// ============================================================
async function runTarget() {
  const dateStr    = new Date().toISOString().split('T')[0];
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - TARGET_CONFIG.epc_max_age_months);
  const cutoffStr  = cutoffDate.toISOString().split('T')[0];

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  MAILING LIST BUILDER — ${dateStr}`);
  console.log(`  EPC lodged after:  ${cutoffStr}`);
  console.log(`  Market events:     ${TARGET_CONFIG.market_events.join(', ')}`);
  console.log(`  Price range:       £${TARGET_CONFIG.min_price.toLocaleString()} – £${TARGET_CONFIG.max_price === 99999999 ? 'no limit' : '£' + TARGET_CONFIG.max_price.toLocaleString()}`);
  console.log(`${'═'.repeat(55)}\n`);

  // ── 1. Fetch recent EPCs with a matched property_key ──
  console.log('Fetching recent EPC records...');
  const epcRes = await fetch(
    `${SB_API}/epc_data?select=property_key,address,postcode,lodgement_date,current_energy_rating,potential_energy_rating,property_type,total_floor_area` +
    `&property_key=not.is.null&lodgement_date=gte.${cutoffStr}&order=lodgement_date.desc&limit=10000`,
    { headers: SB_HEADERS }
  );
  if (!epcRes.ok) {
    const err = await epcRes.text();
    throw new Error(`EPC fetch failed ${epcRes.status}: ${err.substring(0, 200)}`);
  }
  const epcData = await epcRes.json();
  console.log(`  ${epcData.length} recent EPCs found`);

  if (epcData.length === 0) {
    console.log('  Nothing to do — run --import first to load EPC data.\n');
    return;
  }

  // Index EPCs by property_key (keep most recent per property)
  const epcByKey = {};
  for (const e of epcData) {
    if (!epcByKey[e.property_key] ||
        (e.lodgement_date > epcByKey[e.property_key].lodgement_date)) {
      epcByKey[e.property_key] = e;
    }
  }
  const epcKeys = Object.keys(epcByKey);
  console.log(`  ${epcKeys.length} unique properties with recent EPC`);

  // ── 2. Pull listing_changes for those keys ──
  console.log('Fetching market events...');
  const allEvents   = [];
  const batchSize   = 200;
  const eventFilter = TARGET_CONFIG.market_events.map(e => `change_type.eq.${e}`).join(',');

  for (let i = 0; i < epcKeys.length; i += batchSize) {
    const batch    = epcKeys.slice(i, i + batchSize);
    const inFilter = batch.map(k => `"${k}"`).join(',');

    // Try listing_changes first
    const lcRes = await fetch(
      `${SB_API}/listing_changes?select=property_key,full_address,street,postcode,town,change_type,old_value,new_value,price,agent,scan_date` +
      `&property_key=in.(${inFilter})&or=(${eventFilter})&order=scan_date.desc`,
      { headers: SB_HEADERS }
    );
    if (lcRes.ok) {
      const rows = await lcRes.json();
      allEvents.push(...rows.map(r => ({ ...r, _source: 'listing_changes' })));
    }

    // Also check market_status for withdrawn/sold_stc (belt and braces)
    const msFilter = 'status.eq.withdrawn,status.eq.sold_stc';
    const msRes = await fetch(
      `${SB_API}/market_status?select=property_key,status,notes,marked_at` +
      `&property_key=in.(${inFilter})&or=(${msFilter})&order=marked_at.desc`,
      { headers: SB_HEADERS }
    );
    if (msRes.ok) {
      const rows = await msRes.json();
      allEvents.push(...rows.map(r => ({
        property_key: r.property_key,
        change_type:  r.status,
        price:        null,
        agent:        r.notes?.match(/£[\d,]+ · (.+?) \[/)?.[1] || '',
        full_address: r.notes?.split('|')[0]?.trim() || '',
        scan_date:    r.marked_at?.split('T')[0] || '',
        old_value:    null,
        new_value:    r.status,
        _source:      'market_status',
      })));
    }

    process.stdout.write(`  ${Math.min(i + batchSize, epcKeys.length)}/${epcKeys.length} keys checked...\r`);
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(`\n  ${allEvents.length} raw market events found`);

  // ── 3. Fetch property details for all target keys ──
  const targetKeys = [...new Set(allEvents.map(e => e.property_key).filter(Boolean))];
  console.log(`Fetching property details for ${targetKeys.length} properties...`);
  const propertyDetails = {};

  for (let i = 0; i < targetKeys.length; i += batchSize) {
    const batch    = targetKeys.slice(i, i + batchSize);
    const inFilter = batch.map(k => `"${k}"`).join(',');
    const res = await fetch(
      `${SB_API}/properties?select=property_key,address,postcode,property_type,tenure&property_key=in.(${inFilter})`,
      { headers: SB_HEADERS }
    );
    if (res.ok) {
      const rows = await res.json();
      for (const r of rows) propertyDetails[r.property_key] = r;
    }
  }

  // ── 4. Build deduped mailing list ──
  console.log('\nBuilding mailing list...');

  // Priority: price_reduced > withdrawn > sold_stc; most recent first within type
  const eventPriority = { price_reduced: 0, withdrawn: 1, sold_stc: 2 };
  allEvents.sort((a, b) => {
    const pa = eventPriority[a.change_type] ?? 99;
    const pb = eventPriority[b.change_type] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.scan_date || '').localeCompare(a.scan_date || '');
  });

  const seen        = new Set();
  const mailingList = [];

  for (const event of allEvents) {
    const key = event.property_key;
    if (!key || seen.has(key)) continue;

    const epc  = epcByKey[key];
    const prop = propertyDetails[key];
    if (!epc) continue;

    // Price filter
    const rawPrice = event.price
      || parseInt((event.new_value || '').replace(/[^0-9]/g, ''))
      || 0;
    if (rawPrice > 0 && rawPrice < TARGET_CONFIG.min_price) continue;
    if (rawPrice > 0 && rawPrice > TARGET_CONFIG.max_price) continue;

    seen.add(key);

    const eventDescMap = {
      price_reduced: `Price reduced ${event.old_value || ''} → ${event.new_value || ''}`.trim(),
      withdrawn:     'Withdrawn from market',
      sold_stc:      'Sold STC / Under Offer',
    };

    mailingList.push({
      property_key:       key,
      full_address:       event.full_address || prop?.address || epc.address || '',
      postcode:           (epc.postcode || prop?.postcode || '').toUpperCase().trim(),
      event_type:         event.change_type,
      event_description:  eventDescMap[event.change_type] || event.change_type,
      asking_price:       rawPrice || null,
      agent:              event.agent || '',
      event_date:         event.scan_date || null,
      epc_rating:         epc.current_energy_rating || '',
      epc_potential:      epc.potential_energy_rating || '',
      epc_lodged:         epc.lodgement_date || null,
      epc_property_type:  epc.property_type || '',
      epc_floor_area_sqm: epc.total_floor_area || null,
      db_property_type:   prop?.property_type || '',
      tenure:             prop?.tenure || '',
      batch_date:         dateStr,
      mailed:             false,
    });
  }

  console.log(`  ${mailingList.length} properties on mailing list\n`);

  // Breakdown
  const byEvent = {};
  for (const r of mailingList) byEvent[r.event_type] = (byEvent[r.event_type] || 0) + 1;
  console.log('  Breakdown by event:');
  Object.entries(byEvent).sort((a, b) => (eventPriority[a[0]] ?? 99) - (eventPriority[b[0]] ?? 99))
    .forEach(([e, n]) => console.log(`    ${e.padEnd(22)} ${n}`));

  // ── 5a. Write CSV ──
  console.log(`\nWriting CSV → ${TARGET_CONFIG.output_file}`);
  const csvHeaders = [
    'Full Address', 'Postcode', 'Event Type', 'Event Description',
    'Asking Price', 'Agent', 'Event Date',
    'EPC Current Rating', 'EPC Potential Rating', 'EPC Lodged',
    'EPC Property Type', 'Floor Area (sqm)',
    'DB Property Type', 'Tenure', 'Property Key',
  ];
  const csvRows = mailingList.map(r => [
    `"${(r.full_address || '').replace(/"/g, '""')}"`,
    r.postcode,
    r.event_type,
    `"${r.event_description}"`,
    r.asking_price ? `£${r.asking_price.toLocaleString()}` : '',
    `"${(r.agent || '').replace(/"/g, '""')}"`,
    r.event_date || '',
    r.epc_rating,
    r.epc_potential,
    r.epc_lodged || '',
    r.epc_property_type,
    r.epc_floor_area_sqm || '',
    r.db_property_type,
    r.tenure,
    r.property_key,
  ].join(','));

  fs.writeFileSync(TARGET_CONFIG.output_file, [csvHeaders.join(','), ...csvRows].join('\n'), 'utf8');
  console.log(`  ✓ CSV written (${mailingList.length} rows)`);

  // ── 5b. Push to Supabase mailing_targets ──
  console.log('Pushing to Supabase mailing_targets...');
  const sbExists = await tableExists('mailing_targets');
  if (!sbExists) {
    console.warn('  ⚠ mailing_targets table not found — run --setup first.');
    console.warn('  CSV was written successfully so data is not lost.\n');
    return;
  }

  // Don't upsert — each batch run is a new set of rows so we can track history
  const ok = await sbPost('mailing_targets', mailingList, false);
  console.log(`  ✓ ${ok}/${mailingList.length} rows pushed to mailing_targets`);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  DONE — ${mailingList.length} addresses ready for mail drop`);
  console.log(`  CSV:      ${TARGET_CONFIG.output_file}`);
  console.log(`  Supabase: mailing_targets (batch_date = ${dateStr})`);
  console.log(`  Tip: filter mailed = false in Supabase to see unsent addresses`);
  console.log(`       set mailed = true + mailed_at = now() after each send`);
  console.log(`${'═'.repeat(55)}\n`);
}

// ============================================================
// CLI
// ============================================================
async function main() {
  const args     = process.argv.slice(2);
  const doSetup  = args.includes('--setup');
  const doImport = args.includes('--import');
  const doTarget = args.includes('--target');

  if (!doSetup && !doImport && !doTarget) {
    console.log(`
EPC Import & Mailing List Builder
══════════════════════════════════

Usage:
  node epc-import-and-target.js --setup
    Check Supabase tables exist and print SQL to create any missing ones

  node epc-import-and-target.js --import path/to/certificates.csv
    Import an EPC CSV file and match records to your property database

  node epc-import-and-target.js --target
    Build a mailing list of properties with recent EPC + market event
    Outputs: CSV file + rows in Supabase mailing_targets table

  Combine flags:
    node epc-import-and-target.js --setup --import certificates.csv --target

Current targeting config:
  EPC max age:    ${TARGET_CONFIG.epc_max_age_months} months
  Market events:  ${TARGET_CONFIG.market_events.join(', ')}
  Price range:    £${TARGET_CONFIG.min_price.toLocaleString()} – ${TARGET_CONFIG.max_price === 99999999 ? 'no limit' : '£' + TARGET_CONFIG.max_price.toLocaleString()}
  Output file:    ${TARGET_CONFIG.output_file}
    `);
    return;
  }

  if (doSetup)  await runSetup();

  if (doImport) {
    const idx     = args.indexOf('--import') + 1;
    const csvPath = args[idx];
    if (!csvPath || csvPath.startsWith('--')) {
      console.error('  ✗ Please provide a CSV path after --import');
      process.exit(1);
    }
    await runImport(csvPath);
  }

  if (doTarget) await runTarget();
}

main().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
