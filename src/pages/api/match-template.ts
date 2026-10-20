import type { APIRoute } from 'astro';

export const prerender = false;

// ── Data loading (bundled by Vite at build time) ────────────────
import bpIndexRaw from '../../../data/bp_index.json';
import bpPromptsRaw from '../../../data/bp_prompts.json';

const bpIndex: any = bpIndexRaw;
const bpPrompts: any = bpPromptsRaw;

function loadData() {
  // no-op: data is imported at build time
}

// ── Tipe bisnis → mesin mapping ─────────────────────────────────
const TIPE_TO_MESIN: Record<string, string[]> = {
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

function normalize(str: string): string {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

function tokenize(str: string): string[] {
  return normalize(str).split(/\s+/).filter(Boolean);
}

function scoreSimilarity(query: string, target: string): number {
  const qTokens = tokenize(query);
  const tTokens = tokenize(target);
  if (!qTokens.length || !tTokens.length) return 0;

  let matchCount = 0;
  for (const qt of qTokens) {
    for (const tt of tTokens) {
      if (qt === tt) { matchCount += 2; continue; }
      if (tt.includes(qt) || qt.includes(tt)) { matchCount += 1; }
    }
  }
  return matchCount / qTokens.length;
}

function inferMesin(tipeBisnis: string, bidangUsaha: string): string[] {
  const combined = normalize(`${tipeBisnis} ${bidangUsaha}`);

  for (const [key, mesins] of Object.entries(TIPE_TO_MESIN)) {
    if (combined.includes(key)) return mesins;
  }

  const foodKw = ['makanan','minuman','kopi','cafe','kafe','resto','restoran','kuliner','catering','bakery','roti','kue','nasi','ayam','martabak','dimsum','sate','juice','boba','es','warteg','warung','mie','pizza','burger','sushi'];
  const svcKw  = ['salon','barbershop','laundry','klinik','dokter','spa','pijat','fotografi','studio','kursus','les','gym','fitness','bengkel','servis','service','rental','sewa','cleaning','travel','tour','wedding','event'];
  const retKw  = ['toko','shop','fashion','hijab','baju','sepatu','tas','aksesoris','skincare','kosmetik','parfum','gadget','elektronik','furniture','tanaman','bunga','pet','hewan','thrift','preloved'];
  const propKw = ['properti','kost','kos','apartment','apartemen','rumah','villa','hotel','penginapan','kontrakan','ruko'];
  const b2bKw  = ['konsultan','agency','agensi','software','tech','digital','marketing','logistik','distributor','supplier','kontraktor','konstruksi','manufaktur'];
  const persKw = ['portfolio','freelance','seniman','desainer','fotografer','videografer','content creator','influencer','coach','mentor'];

  if (foodKw.some(k => combined.includes(k))) return ['M1'];
  if (svcKw.some(k => combined.includes(k)))  return ['M2'];
  if (retKw.some(k => combined.includes(k)))  return ['M3'];
  if (propKw.some(k => combined.includes(k))) return ['M4'];
  if (b2bKw.some(k => combined.includes(k)))  return ['M5'];
  if (persKw.some(k => combined.includes(k))) return ['M6'];

  return ['M1','M2','M3','M4','M5','M6'];
}

function findBestTemplate(bidangUsaha: string, tipeBisnis: string, clientData: any = {}) {
  loadData();
  const mesinCandidates = inferMesin(tipeBisnis, bidangUsaha);

  const scored = bpIndex.entries
    .filter((e: any) => mesinCandidates.includes(e.m))
    .map((entry: any) => {
      let score = 0;
      score += scoreSimilarity(bidangUsaha, entry.k) * 3;
      score += scoreSimilarity(bidangUsaha, entry.t) * 2;
      score += scoreSimilarity(bidangUsaha, entry.s) * 2;
      score += scoreSimilarity(bidangUsaha, entry.b) * 0.5;
      if (tipeBisnis) score += scoreSimilarity(tipeBisnis, entry.t) * 0.5;
      if (clientData.tone_dan_gaya) score += scoreSimilarity(clientData.tone_dan_gaya, entry.d) * 1;
      return { entry, score };
    })
    .sort((a: any, b: any) => b.score - a.score);

  if (!scored[0] || scored[0].score === 0) {
    const fallback = bpIndex.entries.find((e: any) => mesinCandidates.includes(e.m));
    return fallback ?? bpIndex.entries[0];
  }
  return scored[0].entry;
}

function getFullPrompt(code: string) {
  loadData();
  return bpPrompts.entries.find((e: any) => e.code === code);
}

// ── CORS headers ────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const POST: APIRoute = async ({ request }) => {
  // 1. Parse body — separate try so we see JSON-parse errors clearly
  let body: any;
  try {
    const raw = await request.text();
    body = JSON.parse(raw);
  } catch (parseErr: any) {
    return new Response(
      JSON.stringify({
        error: 'Invalid JSON body',
        detail: parseErr.message,
        hint: 'Check that form values with quotes or newlines are properly escaped',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  try {
    const { bidang_usaha, tipe_bisnis, client_data = {} } = body;

    if (!bidang_usaha && !tipe_bisnis) {
      return new Response(
        JSON.stringify({ error: 'bidang_usaha or tipe_bisnis required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const match = findBestTemplate(bidang_usaha, tipe_bisnis, client_data);
    const promptData = getFullPrompt(match.c);
    const mesinInfo = bpIndex.meta.mesinDefs[match.m];

    const result = {
      matched: true,
      templateCode: match.c,
      templateTitle: match.t || promptData?.title,
      mesin: match.m,
      mesinLabel: `${match.m} ${mesinInfo?.name ?? ''}`.trim(),
      designStyle: match.d || promptData?.design_system_style,
      pages: (match.p || promptData?.pages || []).join(', '),
      prompt1: promptData?.prompt1 ?? '',
      dataProduk: promptData?.data_produk ?? '',
      linkedPrompts: promptData?.linked_prompts ?? '',
    };

    return new Response(
      JSON.stringify({ data: { built: result } }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: err.message, stack: err.stack }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
};
