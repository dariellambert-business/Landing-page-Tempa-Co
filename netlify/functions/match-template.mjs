import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load data at cold-start (cached across invocations)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');

let bpIndex, bpPrompts;
function loadData() {
  if (!bpIndex) {
    bpIndex = JSON.parse(readFileSync(join(dataDir, 'bp_index.json'), 'utf8'));
    bpPrompts = JSON.parse(readFileSync(join(dataDir, 'bp_prompts.json'), 'utf8'));
  }
}

// Map tipe_bisnis (form) → mesin codes
const TIPE_TO_MESIN = {
  'landing page':     ['M1', 'M3', 'M5'],
  'company profile':  ['M5'],
  'undangan digital': ['M6'],
  'sales funnel':     ['M1', 'M3'],
  'portfolio':        ['M6'],
  'online course':    ['M2'],
  'toko online':      ['M3'],
  'restoran':         ['M1'],
  'kafe':             ['M1'],
  'f&b':              ['M1'],
  'fnb':              ['M1'],
  'booking':          ['M2'],
  'jasa':             ['M2'],
  'properti':         ['M4'],
  'listing':          ['M4'],
};

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

function tokenize(str) {
  return normalize(str).split(/\s+/).filter(Boolean);
}

function scoreSimilarity(query, target) {
  const qTokens = tokenize(query);
  const tTokens = tokenize(target);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  let matchCount = 0;
  for (const qt of qTokens) {
    for (const tt of tTokens) {
      // Exact match
      if (qt === tt) { matchCount += 2; continue; }
      // Partial match (substring)
      if (tt.includes(qt) || qt.includes(tt)) { matchCount += 1; }
    }
  }
  return matchCount / qTokens.length;
}

function inferMesin(tipeBisnis, bidangUsaha) {
  const combined = normalize(`${tipeBisnis} ${bidangUsaha}`);

  // Check tipe_bisnis direct map first
  for (const [key, mesins] of Object.entries(TIPE_TO_MESIN)) {
    if (combined.includes(key)) return mesins;
  }

  // Keyword-based inference from bidang_usaha
  const foodKeywords = ['makanan', 'minuman', 'kopi', 'cafe', 'kafe', 'resto', 'restoran', 'kuliner', 'catering', 'bakery', 'roti', 'kue', 'nasi', 'ayam', 'martabak', 'dimsum', 'sate', 'juice', 'boba', 'es', 'warteg', 'warung', 'mie', 'pizza', 'burger', 'sushi'];
  const serviceKeywords = ['salon', 'barbershop', 'laundry', 'klinik', 'dokter', 'spa', 'pijat', 'fotografi', 'studio', 'kursus', 'les', 'gym', 'fitness', 'bengkel', 'servis', 'service', 'rental', 'sewa', 'cleaning', 'travel', 'tour', 'wedding', 'event'];
  const retailKeywords = ['toko', 'shop', 'fashion', 'hijab', 'baju', 'sepatu', 'tas', 'aksesoris', 'skincare', 'kosmetik', 'parfum', 'gadget', 'elektronik', 'furniture', 'tanaman', 'bunga', 'pet', 'hewan', 'thrift', 'preloved'];
  const propertyKeywords = ['properti', 'kost', 'kos', 'apartment', 'apartemen', 'rumah', 'villa', 'hotel', 'penginapan', 'kontrakan', 'ruko'];
  const b2bKeywords = ['konsultan', 'agency', 'agensi', 'software', 'tech', 'digital', 'marketing', 'logistik', 'distributor', 'supplier', 'kontraktor', 'konstruksi', 'manufaktur'];
  const personalKeywords = ['portfolio', 'freelance', 'seniman', 'desainer', 'fotografer', 'videografer', 'content creator', 'influencer', 'coach', 'mentor'];

  if (foodKeywords.some(k => combined.includes(k))) return ['M1'];
  if (serviceKeywords.some(k => combined.includes(k))) return ['M2'];
  if (retailKeywords.some(k => combined.includes(k))) return ['M3'];
  if (propertyKeywords.some(k => combined.includes(k))) return ['M4'];
  if (b2bKeywords.some(k => combined.includes(k))) return ['M5'];
  if (personalKeywords.some(k => combined.includes(k))) return ['M6'];

  // Default: return all, let keyword matching decide
  return ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
}

function findBestTemplate(bidangUsaha, tipeBisnis, clientData = {}) {
  loadData();

  const mesinCandidates = inferMesin(tipeBisnis, bidangUsaha);
  const entries = bpIndex.entries;

  // Score each entry
  const scored = entries
    .filter(e => mesinCandidates.includes(e.m))
    .map(entry => {
      let score = 0;

      // Match against keywords field
      score += scoreSimilarity(bidangUsaha, entry.k) * 3;
      // Match against title
      score += scoreSimilarity(bidangUsaha, entry.t) * 2;
      // Match against sector
      score += scoreSimilarity(bidangUsaha, entry.s) * 2;
      // Match against brand (less weight)
      score += scoreSimilarity(bidangUsaha, entry.b) * 0.5;

      // Bonus if tipe_bisnis also matches
      if (tipeBisnis) {
        score += scoreSimilarity(tipeBisnis, entry.t) * 0.5;
      }

      // Bonus for tone/style match
      if (clientData.tone_dan_gaya) {
        score += scoreSimilarity(clientData.tone_dan_gaya, entry.d) * 1;
      }

      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);

  // Get top match
  const best = scored[0];
  if (!best || best.score === 0) {
    // Fallback: pick first entry of the inferred mesin
    const fallback = entries.find(e => mesinCandidates.includes(e.m));
    return fallback ? fallback : entries[0];
  }

  return best.entry;
}

function getFullPrompt(code) {
  loadData();
  return bpPrompts.entries.find(e => e.code === code);
}

export default async (request) => {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { bidang_usaha, tipe_bisnis, client_data = {} } = body;

    if (!bidang_usaha && !tipe_bisnis) {
      return Response.json(
        { error: 'bidang_usaha or tipe_bisnis required' },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Find best matching template
    const match = findBestTemplate(bidang_usaha, tipe_bisnis, client_data);

    // Get full prompt data
    const promptData = getFullPrompt(match.c);

    const mesinDefs = bpIndex.meta.mesinDefs;
    const mesinInfo = mesinDefs[match.m];

    const result = {
      matched: true,
      templateCode: match.c,
      templateTitle: match.t || promptData?.title,
      mesin: match.m,
      mesinLabel: `${match.m} ${mesinInfo?.name || ''}`.trim(),
      designStyle: match.d || promptData?.design_system_style,
      pages: (match.p || promptData?.pages || []).join(', '),
      prompt1: promptData?.prompt1 || '',
      dataProduk: promptData?.data_produk || '',
      linkedPrompts: promptData?.linked_prompts || '',
    };

    return Response.json(
      { data: { built: result } },
      {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }
    );
  } catch (err) {
    return Response.json(
      { error: 'Internal error', detail: err.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
};

export const config = {
  path: '/.netlify/functions/match-template',
};
