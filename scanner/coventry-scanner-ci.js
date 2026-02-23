const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG — reads from env vars (GitHub Actions) or falls back to hardcoded
// ============================================================
const SD_API_KEY = process.env.SD_API_KEY || 'J9_YL599NqGNc8xksaTjwOwKoMM6HXNG3BP89WfT7Tg';
const SD_BASE = 'https://api.data.street.co.uk/street-data-api/v2';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yeogknaswgithbmpcozu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inllb2drbmFzd2dpdGhibXBjb3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNzkxMzcsImV4cCI6MjA4NTg1NTEzN30.sS_76s17DLrd2NXyWwzCyolxH-kaomgANjsPZDyaAC8';
const SB_API = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates',
};

const SCRIPT_DIR = path.dirname(__filename);
const HISTORY_FILE = path.join(SCRIPT_DIR, 'cv-listings-history.json');

const PUSH_TO_SUPABASE = true;
const WRITE_CSV = !process.env.CI;
const IS_CI = !!process.env.CI;

// ============================================================
// QUERY POINTS — CV1 to CV47 (39 points)
// ============================================================
const QUERY_POINTS = [
  { address: '1 Broadgate', postcode: 'CV1 1NF', label: 'CV1 City Centre' },
  { address: '1 Batsford Road', postcode: 'CV2 4NR', label: 'CV2 Stoke' },
  { address: '154 Deedmore Road', postcode: 'CV2 2AA', label: 'CV2 Walsgrave' },
  { address: '1 Quinton Road', postcode: 'CV3 5HT', label: 'CV3 Cheylesmore' },
  { address: '1 Agincourt Road', postcode: 'CV3 5PT', label: 'CV3 Whitley' },
  { address: '1 Butterworth Drive', postcode: 'CV4 8JL', label: 'CV4 Canley' },
  { address: '349 Tile Hill Lane', postcode: 'CV4 9DU', label: 'CV4 Tile Hill' },
  { address: '39 Warwick Avenue', postcode: 'CV5 6DJ', label: 'CV5 Earlsdon' },
  { address: '27 Wall Hill Road', postcode: 'CV5 9EN', label: 'CV5 Allesley' },
  { address: '1 Barkers Butts Lane', postcode: 'CV6 1DU', label: 'CV6 Coundon' },
  { address: '1 Holbrook Lane', postcode: 'CV6 4DD', label: 'CV6 Holbrooks' },
  { address: '1 Bede Road', postcode: 'CV6 3BW', label: 'CV6 Longford' },
  { address: '1 Bennetts Road', postcode: 'CV6 2FL', label: 'CV6 Keresley' },
  { address: '1 Station Road', postcode: 'CV7 7FF', label: 'CV7 Balsall Common' },
  { address: '384 Kenilworth Road', postcode: 'CV7 7ER', label: 'CV7 Meriden' },
  { address: '1 Mortimer Road', postcode: 'CV8 1FS', label: 'CV8 Kenilworth' },
  { address: '7 Parkfield Drive', postcode: 'CV8 2JJ', label: 'CV8 Kenilworth South' },
  { address: '185 Long Street', postcode: 'CV9 1AH', label: 'CV9 Atherstone' },
  { address: '1 Southlands', postcode: 'CV9 1EH', label: 'CV9 Atherstone South' },
  { address: '1 Camp Hill Drive', postcode: 'CV10 0JX', label: 'CV10 Nuneaton West' },
  { address: '1 Park Lane', postcode: 'CV10 8NL', label: 'CV10 Nuneaton North' },
  { address: '1 Bentley Road', postcode: 'CV11 5LR', label: 'CV11 Nuneaton Centre' },
  { address: '59 Coton Road', postcode: 'CV11 5TS', label: 'CV11 Nuneaton East' },
  { address: '1 Barbridge Road', postcode: 'CV12 9PF', label: 'CV12 Bulkington' },
  { address: '111 Station Road', postcode: 'CV13 0NR', label: 'CV13 Market Bosworth' },
  { address: '50 Murray Road', postcode: 'CV21 3JE', label: 'CV21 Rugby Centre' },
  { address: '1 Pinders Lane', postcode: 'CV21 2SS', label: 'CV21 Rugby North' },
  { address: '1 Anderson Avenue', postcode: 'CV22 5PE', label: 'CV22 Rugby South' },
  { address: '1 Oakfield Road', postcode: 'CV22 6AU', label: 'CV22 Rugby East' },
  { address: '1 Brockhurst Lane', postcode: 'CV23 0RA', label: 'CV23 Dunchurch' },
  { address: '1 Sydenham Drive', postcode: 'CV31 1NJ', label: 'CV31 Leamington North' },
  { address: '1 Rowley Road', postcode: 'CV31 2LJ', label: 'CV31 Whitnash' },
  { address: '10 Rugby Road', postcode: 'CV32 6AA', label: 'CV32 Leamington East' },
  { address: '1 Harbury Lane', postcode: 'CV33 9JN', label: 'CV33 Bishops Tachbrook' },
  { address: '1 Priory Road', postcode: 'CV34 4NA', label: 'CV34 Warwick' },
  { address: '1 Church Street', postcode: 'CV35 8AR', label: 'CV35 Wellesbourne' },
  { address: '1 Telegraph Street', postcode: 'CV36 4DA', label: 'CV36 Shipston' },
  { address: '1 Greenhill Street', postcode: 'CV37 6LF', label: 'CV37 Stratford North' },
  { address: '1 Coventry Street', postcode: 'CV47 0EA', label: 'CV47 Southam' },
];

// ============================================================
// STREET DATA API
// ============================================================
async function queryPoint(address, postcode) {
  const url = `${SD_BASE}/properties/addresses`;
  const fields = 'address|property_type|nearby_listings';

  const res = await fetch(`${url}?fields[property]=${fields}`, {
    method: 'POST',
    headers: { 'x-api-key': SD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { address, postcode } })
  });

  const data = await res.json();
  if (res.status !== 200) {
    return { sales: [], cost: 0, balance: 0, error: data?.detail || 'Unknown error' };
  }

  const cost = data?.meta?.request_cost_gbp || 0;
  const balance = data?.meta?.balance_gbp || 0;
  const nearby = data?.data?.attributes?.nearby_listings || {};
  const sales = nearby.sale_listings || [];
  return { sales, cost, balance, error: null };
}

async function checkRightmoveStatus(listingId) {
  try {
    const numericId = listingId.startsWith('r') ? listingId.substring(1) : listingId;
    const url = `https://www.rightmove.co.uk/properties/${numericId}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow'
    });
    const html = await res.text();
    const h = html.toLowerCase();
    if (h.includes('sold stc') || h.includes('sold subject to contract')) return 'SOLD STC';
    if (h.includes('under offer')) return 'UNDER OFFER';
    if (h.includes('sale agreed')) return 'SALE AGREED';
    if (h.includes('sold') && !h.includes('sold stc')) return 'SOLD';
    if (h.includes('no longer on the market') || h.includes('has been removed') || h.includes('this property has been removed')) return 'WITHDRAWN';
    if (res.status === 404 || h.includes('page not found')) return 'REMOVED';
    if (h.includes('for sale')) return 'STILL LISTED';
    return 'UNKNOWN';
  } catch (e) { return 'CHECK FAILED'; }
}

// ============================================================
// ADDRESS HELPERS
// ============================================================

// Pull all useful address parts out of the API's royal_mail_format object.
// The Street Data API returns: sub_building_name, building_name, building_number,
// thoroughfare, post_town, postcode — we capture all of them now.
function extractAddressParts(listing) {
  const addr = listing.address?.royal_mail_format || {};
  const sub    = (addr.sub_building_name  || '').trim();  // e.g. "Flat 2"
  const name   = (addr.building_name      || '').trim();  // e.g. "Rose Cottage"
  const num    = (addr.building_number    || '').trim();  // e.g. "47"
  const street = (addr.thoroughfare       || '').trim();
  const town   = (addr.post_town          || '').trim();
  const pc     = (addr.postcode           || '').trim();

  // Build a clean full address: "Flat 2, 47 Priory Road" or "Rose Cottage, Church Lane"
  const lineParts = [sub, name, num ? `${num} ${street}` : street].filter(Boolean);
  const fullAddress = lineParts.join(', ');

  // Shorter display version for logs/CSV: "47, Priory Road" or "Rose Cottage, Church Lane"
  const houseRef = sub || name || num || '';
  const displayAddress = houseRef ? `${houseRef}, ${street}` : street;

  return { sub, name, num, street, town, postcode: pc, fullAddress, displayAddress };
}

// Normalise a string for comparison
function norm(s) {
  return (s || '').toUpperCase().trim().replace(/[.,]+$/, '').replace(/\s+/g, ' ');
}

// Does a DB address string contain the building number / name from the listing?
function buildingMatches(dbAddress, num, name, sub) {
  const db = norm(dbAddress);
  if (num) {
    const n = norm(num);
    // Match "47 " at start, or after comma/space, or with letter suffix e.g. "47A"
    if (db.startsWith(n + ' ') || db.includes(', ' + n + ' ') || db.includes(' ' + n + ' ') || db.includes(' ' + n + ',')) return true;
    if (db.match(new RegExp(`\\b${n}[A-Z]?\\b`))) return true;
  }
  if (name && db.includes(norm(name))) return true;
  if (sub  && db.includes(norm(sub)))  return true;
  return false;
}

// ============================================================
// SUPABASE — Fetch properties for matching
// ============================================================
async function fetchAllProperties() {
  console.log('Fetching properties from Supabase for matching...');
  let allProps = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const res = await fetch(
      `${SB_API}/properties?select=property_key,address,postcode&offset=${offset}&limit=${pageSize}&order=property_key`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
    const batch = await res.json();
    if (!batch || batch.length === 0) break;
    allProps = allProps.concat(batch);
    offset += pageSize;
    if (offset % 10000 === 0) process.stdout.write(`  ${allProps.length.toLocaleString()} rows...\n`);
  }

  console.log(`  Fetched ${allProps.length.toLocaleString()} properties from Supabase`);
  return allProps;
}

// ============================================================
// MATCHING
// ============================================================

function extractStreetFromAddress(address) {
  const addr = (address || '').toUpperCase().trim();
  const parts = addr.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const first = parts[0];
    if (/^\d+[A-Z]?$/.test(first)) return parts.slice(1).join(' ').trim();
    if (/^(FLAT|UNIT|APARTMENT|ROOM)\s/i.test(first)) return parts.slice(1).join(' ').trim();
    return parts[parts.length - 1].trim();
  }
  return addr;
}

// Build index: postcode → street → [{property_key, address}]
// Storing the full DB address alongside each key lets us do building-level matching later.
function buildPropertyIndex(properties) {
  const index = {};
  let indexed = 0;

  for (const p of properties) {
    const pc = (p.postcode || '').toUpperCase().trim();
    if (!pc) continue;
    const street = norm(extractStreetFromAddress(p.address));
    if (!street) continue;

    if (!index[pc]) index[pc] = {};
    if (!index[pc][street]) index[pc][street] = [];
    index[pc][street].push({ property_key: p.property_key, address: p.address || '' });
    indexed++;
  }

  const postcodes = Object.keys(index).length;
  const streets = Object.values(index).reduce((sum, pc) => sum + Object.keys(pc).length, 0);
  console.log(`  Built index: ${postcodes} postcodes, ${streets} streets, ${indexed} properties`);
  return index;
}

// Match a listing to DB property_keys.
// Returns [{property_key, address, matchType}]
// matchType: 'exact' = house number matched | 'street' = street only (no number available)
function matchListingToProperties(listing, propertyIndex) {
  const { num, name, sub, street: thoroughfare, postcode: pc } = extractAddressParts(listing);

  if (!pc || !thoroughfare || !propertyIndex[pc]) return [];

  // Find street-level candidates
  let candidates = propertyIndex[pc][norm(thoroughfare)];
  if (!candidates) {
    candidates = [];
    for (const [s, entries] of Object.entries(propertyIndex[pc])) {
      if (s.includes(norm(thoroughfare)) || norm(thoroughfare).includes(s)) {
        candidates = candidates.concat(entries);
      }
    }
  }

  if (candidates.length === 0) return [];

  // If we have a building number / name, try to pin to one specific property
  if (num || name || sub) {
    const precise = candidates.filter(c => buildingMatches(c.address, num, name, sub));
    if (precise.length > 0) {
      return precise.map(c => ({ ...c, matchType: 'exact' }));
    }
  }

  // No building identifier — return all street-level candidates flagged as imprecise
  return candidates.map(c => ({ ...c, matchType: 'street' }));
}

// ============================================================
// SUPABASE — Push data
// ============================================================
async function upsertPropertyDataListings(rows) {
  if (rows.length === 0) return 0;
  let success = 0;
  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    try {
      const res = await fetch(`${SB_API}/propertydata_listings`, { method: 'POST', headers, body: JSON.stringify(batch) });
      if (res.ok) { success += batch.length; }
      else { const err = await res.text(); console.warn(`  ⚠ propertydata_listings batch error: ${err.substring(0, 200)}`); }
    } catch (e) { console.warn(`  ⚠ propertydata_listings network error: ${e.message}`); }
  }
  return success;
}

async function insertMarketStatus(rows) {
  if (rows.length === 0) return 0;
  let success = 0;
  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    try {
      const res = await fetch(`${SB_API}/market_status`, { method: 'POST', headers, body: JSON.stringify(batch) });
      if (res.ok) { success += batch.length; }
      else { const err = await res.text(); console.warn(`  ⚠ market_status batch error: ${err.substring(0, 200)}`); }
    } catch (e) { console.warn(`  ⚠ market_status network error: ${e.message}`); }
  }
  return success;
}

async function insertListingChanges(rows) {
  if (rows.length === 0) return 0;
  let success = 0;
  // Use upsert with merge-duplicates so re-runs never double-log the same
  // (listing_id, change_type, scan_date) combination.
  // Requires unique index: CREATE UNIQUE INDEX ON listing_changes (listing_id, change_type, scan_date);
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates',
  };
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    try {
      const res = await fetch(`${SB_API}/listing_changes`, { method: 'POST', headers, body: JSON.stringify(batch) });
      if (res.ok) { success += batch.length; }
      else { const err = await res.text(); console.warn(`  ⚠ listing_changes batch error: ${err.substring(0, 200)}`); }
    } catch (e) { console.warn(`  ⚠ listing_changes network error: ${e.message}`); }
  }
  return success;
}

// ============================================================
// HELPERS
// ============================================================
function formatListing(l) {
  const { sub, name, num, street, town, postcode, fullAddress, displayAddress } = extractAddressParts(l);
  return {
    house_number:    num,
    building_name:   name,
    sub_building:    sub,
    full_address:    fullAddress,      // e.g. "Flat 2, 47 Priory Road"
    display_address: displayAddress,   // e.g. "47, Priory Road"
    street,
    postcode,
    town,
    price:           l.price || '',
    agent:           (l.agent?.company_name || '').replace(/,/g, ''),
    branch:          (l.agent?.branch_name  || '').replace(/,/g, ''),
    listed_date:     l.listed_date || '',
    bedrooms:        l.number_of_bedrooms || '',
    bathrooms:       l.number_of_bathrooms || '',
    property_type:   l.property_type?.value || '',
    source:          l.source || '',
    listing_id:      l.listing_id || '',
    rightmove_url:   (l.listing_id || '').startsWith('r')
      ? `https://www.rightmove.co.uk/properties/${l.listing_id.substring(1)}`
      : ''
  };
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) { console.log('  (No history file, starting fresh)'); }
  return { scans: [], listings: {} };
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

function writeCSV(filename, rows, extraColumns = []) {
  const baseCols = ['Full Address', 'Street', 'Postcode', 'Town', 'Price', 'Agent', 'Branch', 'Listed Date', 'Bedrooms', 'Bathrooms', 'Property Type', 'Source', 'Listing ID', 'Rightmove URL'];
  const header = [...baseCols, ...extraColumns].join(',') + '\n';
  const csvRows = rows.map(r => {
    const base = `"${r.full_address || r.display_address || ''}",${r.street},${r.postcode},${r.town},${r.price},${r.agent},${r.branch},${r.listed_date},${r.bedrooms},${r.bathrooms},${r.property_type},${r.source},${r.listing_id},${r.rightmove_url}`;
    const extra = extraColumns.map(c => r[c.toLowerCase().replace(/ /g, '_')] || '').join(',');
    return extra ? `${base},${extra}` : base;
  });
  fs.writeFileSync(filename, header + csvRows.join('\n'), 'utf8');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  CV AREA LISTINGS SCANNER — ${dateStr}`);
  console.log(`  ${QUERY_POINTS.length} query points | CV1-CV47`);
  console.log(`  Supabase push: ${PUSH_TO_SUPABASE ? 'ON' : 'OFF (dry run)'}`);
  console.log(`  Environment: ${IS_CI ? 'GitHub Actions' : 'Local'}`);
  console.log(`${'═'.repeat(55)}\n`);

  // ── 1. Load history ──
  const history = loadHistory();
  const previousIds = new Set(
    Object.entries(history.listings)
      .filter(([_, l]) => !['withdrawn', 'WITHDRAWN', 'REMOVED', 'SOLD', 'SOLD STC'].includes(l.status))
      .map(([id]) => id)
  );
  const hadPrevious = previousIds.size > 0;
  if (hadPrevious) {
    const last = history.scans[history.scans.length - 1];
    console.log(`Previous scan: ${last?.date} (${previousIds.size} active)\n`);
  } else {
    console.log('First scan — establishing baseline.\n');
  }

  // ── 2. Fetch Supabase properties ──
  let propertyIndex = {};
  let totalDbProperties = 0;
  try {
    const properties = await fetchAllProperties();
    totalDbProperties = properties.length;
    propertyIndex = buildPropertyIndex(properties);
  } catch (e) {
    console.warn(`  ⚠ Could not fetch properties: ${e.message}`);
    console.warn('  Scanner will still run but cannot match to database.\n');
  }

  // ── 3. Scan all query points ──
  console.log('\nScanning listings...');
  const allListings = new Map();
  let totalCost = 0;
  let balance = 0;
  let errors = 0;

  for (let i = 0; i < QUERY_POINTS.length; i++) {
    const qp = QUERY_POINTS[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${QUERY_POINTS.length}] ${qp.label.padEnd(28)}  `);

    const result = await queryPoint(qp.address, qp.postcode);
    totalCost += result.cost;
    balance = result.balance;

    if (result.error) {
      console.log(`ERROR: ${JSON.stringify(result.error).substring(0, 60)}`);
      errors++;
      continue;
    }

    let newCount = 0;
    for (const l of result.sales) {
      if (!allListings.has(l.listing_id)) {
        allListings.set(l.listing_id, l);
        newCount++;
      }
    }
    console.log(`${String(result.sales.length).padStart(3)} listings (${String(newCount).padStart(3)} new)  total: ${allListings.size}  £${result.cost}`);
    await new Promise(r => setTimeout(r, 400));
  }

  // ── 4. Detect changes ──
  const currentIds = new Set(allListings.keys());
  const newIds = [...currentIds].filter(id => !previousIds.has(id));
  const withdrawnIds = [...previousIds].filter(id => !currentIds.has(id));

  // ── 5. Match listings to database properties ──
  console.log('\nMatching to database...');
  const pdRows = [];
  const msRows = [];
  let matchedListings = 0;
  let matchedProperties = 0;
  let exactMatches = 0;
  let streetOnlyMatches = 0;
  const now = new Date().toISOString();
  const priceReduced = [];

  for (const [listingId, listing] of allListings) {
    const matches = matchListingToProperties(listing, propertyIndex);

    if (matches.length > 0) {
      matchedListings++;
      matchedProperties += matches.length;

      const addrParts = extractAddressParts(listing);
      const isExact = matches[0].matchType === 'exact';
      if (isExact) exactMatches++; else streetOnlyMatches++;

      const portalDomain = (listing.source || 'rightmove').replace('www.', '');
      const portalUrl = portalDomain.includes('.') ? portalDomain : `${portalDomain}.co.uk`;

      const prev = history.listings[listingId];
      const firstPrice = prev?.first_price || listing.price || null;
      const currentPrice = listing.price || null;
      const lastKnownPrice = prev?.last_price || firstPrice;
      // Only log a reduction if the price has actually CHANGED since the last scan
      // (not just if it's lower than first_price, which would re-log on every run)
      const isReduced = firstPrice && currentPrice && currentPrice < firstPrice && currentPrice !== lastKnownPrice;
      const drop = isReduced ? firstPrice - currentPrice : 0;
      const pct  = isReduced ? Math.round((drop / firstPrice) * 100) : 0;

      if (isReduced) {
        priceReduced.push({
          listing_id:     listingId,
          full_address:   addrParts.fullAddress,
          street:         addrParts.street,
          postcode:       addrParts.postcode,
          original_price: firstPrice,
          current_price:  currentPrice,
          drop,
          pct,
          agent:          listing.agent?.company_name || 'Unknown',
          match_type:     isExact ? 'exact' : 'street',
        });
      }

      for (const match of matches) {
        const pkPostcode = match.property_key.split('|')[1] || '';
        // Use the DB's own address when exact-matched (most accurate), otherwise use listing address
        const resolvedAddress = isExact ? match.address : addrParts.fullAddress;

        pdRows.push({
          property_key:     match.property_key,
          postcode:         pkPostcode,
          is_listed:        true,
          listing_status:   isReduced ? 'reduced' : 'listed',
          portal:           portalUrl,
          asking_price:     currentPrice,
          original_price:   firstPrice,
          pd_property_type: listing.property_type?.value || null,
          pd_bedrooms:      listing.number_of_bedrooms || null,
          checked_at:       now,
          match_type:       match.matchType,
          resolved_address: resolvedAddress,
        });

        if (newIds.includes(listingId)) {
          msRows.push({
            property_key: match.property_key,
            status:       'on_market',
            marked_by:    'Scanner',
            marked_at:    now,
            notes:        `${resolvedAddress} | £${(currentPrice || 0).toLocaleString()} · ${listing.agent?.company_name || 'Unknown'} [${match.matchType}]`,
            source:       `Street Data (${listingId})`,
          });
        }

        if (isReduced) {
          msRows.push({
            property_key: match.property_key,
            status:       'on_market',
            marked_by:    'Scanner',
            marked_at:    now,
            notes:        `⬇ REDUCED ${resolvedAddress} | £${firstPrice.toLocaleString()} → £${currentPrice.toLocaleString()} (-${pct}%) · ${listing.agent?.company_name || 'Unknown'} [${match.matchType}]`,
            source:       `Price reduction (${listingId})`,
          });
        }
      }
    }
  }

  console.log(`  ${matchedListings} listings matched → ${matchedProperties} properties`);
  console.log(`  ✓ Exact (house-level): ${exactMatches}  |  ~ Street-level only: ${streetOnlyMatches}`);
  if (newIds.length > 0) console.log(`  ${newIds.length} NEW listings → ${msRows.length} market status updates`);

  // ── 6. Check Rightmove for withdrawn ──
  const withdrawnRows = [];
  if (withdrawnIds.length > 0) {
    console.log(`\nChecking ${withdrawnIds.length} withdrawn listings on Rightmove...`);
    for (let i = 0; i < withdrawnIds.length; i++) {
      const id = withdrawnIds[i];
      const prev = history.listings[id];
      if (!prev) continue;

      const row = { ...prev };
      row.withdrawn_date = dateStr;
      row.days_on_market = prev.first_seen
        ? Math.round((new Date(dateStr) - new Date(prev.first_seen)) / 86400000) : '';

      // Use full address from history if available
      const displayAddr = prev.full_address || prev.display_address || `${prev.street}, ${prev.postcode}`;
      process.stdout.write(`  [${i + 1}/${withdrawnIds.length}] ${displayAddr}... `);

      const rmStatus = await checkRightmoveStatus(id);
      row.rightmove_status = rmStatus;
      console.log(rmStatus);
      withdrawnRows.push(row);

      if (totalDbProperties > 0) {
        const pc = (prev.postcode || '').toUpperCase().trim();
        const street = norm(prev.street);

        if (propertyIndex[pc]) {
          let candidates = propertyIndex[pc][street] || [];
          if (candidates.length === 0) {
            for (const [s, entries] of Object.entries(propertyIndex[pc])) {
              if (s.includes(street) || street.includes(s)) { candidates = entries; break; }
            }
          }

          // Try to pin to exact property using saved house number / building name from history
          let keys = candidates;
          if (prev.house_number || prev.building_name || prev.sub_building) {
            const precise = candidates.filter(c =>
              buildingMatches(c.address, prev.house_number, prev.building_name, prev.sub_building)
            );
            if (precise.length > 0) keys = precise;
          }

          if (keys.length > 0) {
            const sbStatus =
              (rmStatus === 'SOLD STC' || rmStatus === 'UNDER OFFER' || rmStatus === 'SALE AGREED') ? 'sold_stc'
              : rmStatus === 'SOLD' ? 'sold'
              : (rmStatus === 'WITHDRAWN' || rmStatus === 'REMOVED') ? 'withdrawn'
              : null;

            if (sbStatus) {
              for (const k of keys) {
                const key = typeof k === 'string' ? k : k.property_key;
                const pkPostcode = key.split('|')[1] || '';
                const resolvedAddress = typeof k === 'object' ? k.address : displayAddr;
                msRows.push({
                  property_key: key,
                  status:       sbStatus,
                  marked_by:    'Scanner',
                  marked_at:    now,
                  notes:        `${rmStatus} · ${resolvedAddress} · Was £${prev.price || '?'} with ${prev.agent || 'unknown'}`,
                  source:       `Rightmove status check`,
                });
                pdRows.push({
                  property_key:     key,
                  postcode:         pkPostcode,
                  is_listed:        false,
                  listing_status:   sbStatus === 'sold_stc' ? 'sold_stc' : sbStatus === 'sold' ? 'sold' : 'withdrawn',
                  portal:           'rightmove.co.uk',
                  asking_price:     prev.price ? parseInt(prev.price) : null,
                  original_price:   prev.price ? parseInt(prev.price) : null,
                  pd_property_type: null,
                  pd_bedrooms:      null,
                  checked_at:       now,
                  resolved_address: resolvedAddress,
                });
              }
            }
          }
        }
      }

      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── 6b. Build listing_changes rows ──
  const changeRows = [];

  for (const id of newIds) {
    const l = allListings.get(id);
    const ap = extractAddressParts(l);
    changeRows.push({
      listing_id:   id,
      full_address: ap.fullAddress,
      street:       ap.street,
      postcode:     ap.postcode,
      town:         ap.town,
      change_type:  'new_listing',
      old_value:    null,
      new_value:    `£${(l.price || 0).toLocaleString()}`,
      price:        l.price || null,
      agent:        l.agent?.company_name || 'Unknown',
      scan_date:    dateStr,
    });
  }

  for (const r of priceReduced) {
    changeRows.push({
      listing_id:   r.listing_id,
      full_address: r.full_address,
      street:       r.street,
      postcode:     r.postcode,
      town:         '',
      change_type:  'price_reduced',
      old_value:    `£${r.original_price.toLocaleString()}`,
      new_value:    `£${r.current_price.toLocaleString()}`,
      price:        r.current_price,
      agent:        r.agent,
      scan_date:    dateStr,
      match_type:   r.match_type,
    });
  }

  for (const w of withdrawnRows) {
    const rmStatus = w.rightmove_status || 'WITHDRAWN';
    let changeType = 'withdrawn';
    if (rmStatus === 'SOLD STC' || rmStatus === 'UNDER OFFER' || rmStatus === 'SALE AGREED') changeType = 'sold_stc';
    else if (rmStatus === 'SOLD') changeType = 'sold';

    changeRows.push({
      listing_id:   w.listing_id,
      full_address: w.full_address || w.display_address || w.street,
      street:       w.street || '',
      postcode:     w.postcode || '',
      town:         w.town || '',
      change_type:  changeType,
      old_value:    `£${(w.price || 0).toLocaleString()}`,
      new_value:    rmStatus,
      price:        w.price ? parseInt(w.price) : null,
      agent:        w.agent || 'Unknown',
      scan_date:    dateStr,
    });
  }

  // ── 7. Push to Supabase ──
  if (PUSH_TO_SUPABASE && (pdRows.length > 0 || msRows.length > 0 || changeRows.length > 0)) {
    console.log(`\nPushing to Supabase...`);
    if (pdRows.length > 0) {
      const ok = await upsertPropertyDataListings(pdRows);
      console.log(`  propertydata_listings: ${ok}/${pdRows.length} rows`);
    }
    if (msRows.length > 0) {
      const ok = await insertMarketStatus(msRows);
      console.log(`  market_status:         ${ok}/${msRows.length} rows`);
    }
    if (changeRows.length > 0) {
      const ok = await insertListingChanges(changeRows);
      console.log(`  listing_changes:       ${ok}/${changeRows.length} rows`);
    }
    console.log('  ✓ Supabase updated');
  }

  // ── 8. Write CSVs (local only) ──
  let activeFile = null, withdrawnFile = null;
  if (WRITE_CSV) {
    const sorted = [...allListings.values()].sort((a, b) => {
      const pcA = a.address?.royal_mail_format?.postcode || '';
      const pcB = b.address?.royal_mail_format?.postcode || '';
      return pcA !== pcB ? pcA.localeCompare(pcB) : (a.price || 0) - (b.price || 0);
    });

    activeFile = `cv-listings-${dateStr}-${timeStr}.csv`;
    const activeRows = sorted.map(l => {
      const row = formatListing(l);
      row.status = newIds.includes(l.listing_id) ? 'NEW' : 'Active';
      row.first_seen = history.listings[l.listing_id]?.first_seen || dateStr;
      return row;
    });
    writeCSV(activeFile, activeRows, ['Status', 'First Seen']);

    if (withdrawnRows.length > 0) {
      withdrawnRows.sort((a, b) => (a.postcode || '').localeCompare(b.postcode || ''));
      withdrawnFile = `cv-withdrawn-${dateStr}-${timeStr}.csv`;
      writeCSV(withdrawnFile, withdrawnRows, ['Withdrawn Date', 'Days On Market', 'Rightmove Status']);
    }
  }

  // ── 9. Update history ──
  for (const [id, l] of allListings) {
    const formatted = formatListing(l);
    formatted.first_seen  = history.listings[id]?.first_seen  || dateStr;
    formatted.first_price = history.listings[id]?.first_price || l.price || null;
    formatted.last_price  = l.price || null;  // Track last known price to detect NEW reductions only
    formatted.status      = newIds.includes(id) ? 'NEW' : 'Active';
    history.listings[id]  = formatted;
  }
  for (const id of withdrawnIds) {
    if (history.listings[id]) {
      history.listings[id].withdrawn_date = dateStr;
      const rmRow = withdrawnRows.find(r => r.listing_id === id);
      history.listings[id].status = rmRow?.rightmove_status || 'withdrawn';
    }
  }
  const cutoff = new Date(dateStr); cutoff.setDate(cutoff.getDate() - 90);
  for (const [id, l] of Object.entries(history.listings)) {
    if (l.withdrawn_date && new Date(l.withdrawn_date) < cutoff) delete history.listings[id];
  }
  history.scans.push({
    date: dateStr, time: timeStr,
    total_active:           currentIds.size,
    new_listings:           newIds.length,
    withdrawn:              withdrawnIds.length,
    price_reduced:          priceReduced.length,
    listing_changes_logged: changeRows.length,
    cost:                   totalCost,
    matched_listings:       matchedListings,
    matched_properties:     matchedProperties,
    exact_matches:          exactMatches,
    street_only_matches:    streetOnlyMatches,
    pushed_to_supabase:     PUSH_TO_SUPABASE,
  });
  saveHistory(history);

  // ── 10. Summary ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  SUMMARY — ${dateStr}`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Active listings:      ${allListings.size}`);
  if (hadPrevious) {
    console.log(`  NEW this scan:        ${newIds.length}`);
    console.log(`  WITHDRAWN/SOLD:       ${withdrawnIds.length}`);
    console.log(`  PRICE REDUCED:        ${priceReduced.length}`);
  }
  console.log(`  CHANGES LOGGED:       ${changeRows.length}`);
  console.log(`  ─── Database matching ───`);
  console.log(`  Properties in DB:     ${totalDbProperties.toLocaleString()}`);
  console.log(`  Listings matched:     ${matchedListings} → ${matchedProperties} properties`);
  console.log(`  ✓ Exact (house #):    ${exactMatches}`);
  console.log(`  ~ Street-level only:  ${streetOnlyMatches}`);
  console.log(`  Pushed to Supabase:   ${pdRows.length} listings + ${msRows.length} statuses + ${changeRows.length} changes`);
  console.log(`  ─── Cost ───`);
  console.log(`  Query points:         ${QUERY_POINTS.length} (${errors} errors)`);
  console.log(`  Cost:                 £${totalCost.toFixed(2)}`);
  console.log(`  Balance:              £${balance}`);
  console.log(`  Time:                 ${elapsed}s`);
  if (WRITE_CSV) {
    console.log(`  ─── Files ───`);
    if (activeFile)    console.log(`  Active:    ${activeFile}`);
    if (withdrawnFile) console.log(`  Withdrawn: ${withdrawnFile}`);
  }
  console.log(`  History:   ${HISTORY_FILE}`);

  const postcodes = {};
  for (const [_, l] of allListings) {
    const pc = (l.address?.royal_mail_format?.postcode || '').split(' ')[0];
    postcodes[pc] = (postcodes[pc] || 0) + 1;
  }
  console.log('\n  Listings by district:');
  Object.entries(postcodes).sort((a, b) => {
    const na = parseInt(a[0].replace(/[A-Z]/g, '')); const nb = parseInt(b[0].replace(/[A-Z]/g, ''));
    return na - nb;
  }).forEach(([pc, count]) => console.log(`    ${pc.padEnd(6)} ${count}`));

  const agents = {};
  for (const [_, l] of allListings) {
    const a = l.agent?.company_name || 'Unknown';
    agents[a] = (agents[a] || 0) + 1;
  }
  console.log('\n  Top 10 agents:');
  Object.entries(agents).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([name, count]) => console.log(`    ${String(count).padStart(4)}  ${name}`));

  if (priceReduced.length > 0) {
    console.log(`\n  ══ PRICE REDUCED 📉 (${priceReduced.length}) ══`);
    priceReduced.sort((a, b) => b.pct - a.pct);
    priceReduced.forEach(r => {
      const tag = r.match_type === 'exact' ? '✓' : '~';
      console.log(`    ${tag} ${r.full_address}, ${r.postcode} | £${r.original_price.toLocaleString()} → £${r.current_price.toLocaleString()} (-${r.pct}%) | ${r.agent}`);
    });
  }

  if (withdrawnRows.length > 0) {
    const sstc      = withdrawnRows.filter(w => ['SOLD STC', 'UNDER OFFER', 'SALE AGREED'].includes(w.rightmove_status));
    const sold      = withdrawnRows.filter(w => w.rightmove_status === 'SOLD');
    const withdrawn = withdrawnRows.filter(w => ['WITHDRAWN', 'REMOVED'].includes(w.rightmove_status));

    if (sstc.length) {
      console.log(`\n  ══ SOLD STC / UNDER OFFER (${sstc.length}) ══`);
      sstc.forEach(w => console.log(`    ${w.full_address || w.street}, ${w.postcode} | £${w.price} | ${w.agent} | ${w.rightmove_status}`));
    }
    if (sold.length) {
      console.log(`\n  ══ SOLD (${sold.length}) ══`);
      sold.forEach(w => console.log(`    ${w.full_address || w.street}, ${w.postcode} | £${w.price} | ${w.agent}`));
    }
    if (withdrawn.length) {
      console.log(`\n  ══ WITHDRAWN — HOT LEADS 🔥 (${withdrawn.length}) ══`);
      withdrawn.forEach(w => console.log(`    ${w.full_address || w.street}, ${w.postcode} | £${w.price} | ${w.agent} | ${w.days_on_market} days`));
    }
  }

  console.log(`\n${'═'.repeat(55)}\n`);
}

main().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
