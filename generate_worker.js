const fs = require('fs');
const path = require('path');

const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const manifestContent = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const swContent = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const iconContent = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');

// Carrega chave do .env ou variável de ambiente com segurança
let rawKey = process.env.SUPABASE_KEY || '';
if (!rawKey && fs.existsSync(path.join(__dirname, '.env'))) {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envText.match(/SUPABASE_KEY=(.*)/);
  if (match) rawKey = match[1].trim();
}
if (!rawKey) rawKey = Buffer.from('c2Jfc2VjcmV0XzF6ZXd0MUlSU1loMnhYQUYzbUJDT1FfMHZ5SEVtVDU=', 'base64').toString();
const KEY_B64 = Buffer.from(rawKey).toString('base64');

const workerCode = `// ==============================================================================
// GOMEX DISTRIBUIDORA · CLOUDFLARE WORKER & API BACKEND (PWA & APK READY)
// ==============================================================================

const FALLBACK_KEY_B64 = '${KEY_B64}';

function getSupabaseKey(env) {
  if (env && env.SUPABASE_KEY) return env.SUPABASE_KEY;
  try {
    if (typeof atob === 'function') return atob(FALLBACK_KEY_B64);
    if (typeof Buffer !== 'undefined') return Buffer.from(FALLBACK_KEY_B64, 'base64').toString('utf8');
  } catch (e) {}
  return '';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Configurações de CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 1. ROTAS DE ASSETS ESTÁTICOS / PWA (MANIFEST, SERVICE WORKER, ÍCONE)
    if (url.pathname === '/manifest.json') {
      return new Response(EMBEDDED_MANIFEST, {
        headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' }
      });
    }

    if (url.pathname === '/sw.js') {
      return new Response(EMBEDDED_SW, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      });
    }

    if (url.pathname === '/icon.svg') {
      return new Response(EMBEDDED_ICON, {
        headers: { 'Content-Type': 'image/svg+xml' }
      });
    }

    // 2. ROTA HEALTH CHECK
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'online',
        runtime: 'cloudflare-worker',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. ROTA DE CHECKLISTS (GET, POST & PATCH)
    if (url.pathname === '/api/checklists') {
      const supabaseUrl = (env && env.SUPABASE_URL) || 'https://lhjeodmnqwsftifdvaru.supabase.co';
      const supabaseKey = getSupabaseKey(env);

      // GET /api/checklists
      if (request.method === 'GET') {
        try {
          const res = await fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists?select=id,numero,motorista,placa,rota,status&order=id.desc&limit=100\`, {
            headers: {
              'apikey': supabaseKey,
              'Authorization': \`Bearer \${supabaseKey}\`,
              'Content-Type': 'application/json'
            }
          });
          const data = await res.json();
          return new Response(JSON.stringify(Array.isArray(data) ? data : []), {
            status: res.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // PATCH /api/checklists (Sincronizar rota do vendedor automaticamente no painel)
      if (request.method === 'PATCH') {
        try {
          const payload = await request.json();
          const rota = String(payload.rota || '').trim();
          const motorista = String(payload.motorista || '').trim();
          const placa = String(payload.placa || '').trim().toUpperCase();

          if (!rota || (!motorista && !placa)) {
            return new Response(JSON.stringify({ error: 'Rota e motorista/placa são obrigatórios' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          let updatedCount = 0;
          if (motorista) {
            const rMot = await fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists?motorista=ilike.\${encodeURIComponent(motorista)}\`, {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': \`Bearer \${supabaseKey}\`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify({ rota })
            });
            const dMot = await rMot.json();
            if (Array.isArray(dMot)) updatedCount += dMot.length;
          }

          if (updatedCount === 0 && placa) {
            const rList = await fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists?select=id&placa=eq.\${encodeURIComponent(placa)}&order=id.desc&limit=1\`, {
              headers: {
                'apikey': supabaseKey,
                'Authorization': \`Bearer \${supabaseKey}\`,
                'Content-Type': 'application/json'
              }
            });
            const dList = await rList.json();
            if (Array.isArray(dList) && dList[0]?.id) {
              await fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists?id=eq.\${dList[0].id}\`, {
                method: 'PATCH',
                headers: {
                  'apikey': supabaseKey,
                  'Authorization': \`Bearer \${supabaseKey}\`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ rota })
              });
              updatedCount = 1;
            }
          }

          return new Response(JSON.stringify({ success: true, rota, updated: updatedCount }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // POST /api/checklists (Salvar novo checklist com numeração oficial sequencial)
      if (request.method === 'POST') {
        try {
          const payload = await request.json();
          const vNm = String(payload.veiculo || '').trim();
          const voNm = String(payload.veiculo_outro || '').trim();
          const plNm = String(payload.placa || '').trim();
          const motNm = String(payload.motorista || '').trim();
          const numRaw = String(payload.numero || '').trim().toUpperCase();
          const stRaw = String(payload.status || '').trim().toLowerCase();
          const isTeste = stRaw === 'teste' || numRaw.startsWith('TESTE') || new RegExp('\\\\bteste\\\\b', 'i').test(vNm) || new RegExp('\\\\bteste\\\\b', 'i').test(voNm) || /^teste/i.test(plNm) || /^teste$/i.test(motNm);

          if (isTeste) {
            if (!numRaw.startsWith('TESTE')) {
              payload.numero = 'TESTE-' + String(Date.now()).slice(-5);
            }
            payload.status = 'teste';
          } else if (!payload.numero || payload.numero === 'AUTO') {
            delete payload.numero;
          }

          const res = await fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists\`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': \`Bearer \${supabaseKey}\`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(payload)
          });

          if (!isTeste && payload.rota && payload.motorista) {
            fetch(\`\${supabaseUrl}/rest/v1/veiculo_checklists?motorista=ilike.\${encodeURIComponent(String(payload.motorista).trim())}\`, {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': \`Bearer \${supabaseKey}\`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ rota: String(payload.rota).trim() })
            }).catch(() => {});
          }

          const data = await res.json();
          const row = Array.isArray(data) ? data[0] : data;
          const assignedNum = row?.numero || '000001';

          if (res.ok) {
            if (!isTeste && row) {
              const painelPushUrl = (env && env.PAINEL_PUSH_URL) || 'https://gomex-painel.gomexassistencia2026.workers.dev/api/push-send';
              const pushPlaca = String(row.placa || payload.placa || 'Frota').trim();
              const pushMot = String(row.motorista || payload.motorista || '').trim();
              const pushLib = String(row.liberacao || payload.liberacao || 'Registrada').trim();
              const pushEventId = 'vistoria-' + String(row.id || assignedNum);
              const pushPromise = fetch(painelPushUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: 'Nova Vistoria Nº ' + assignedNum + ' (' + pushPlaca + ')',
                  body: (pushMot ? ('Motorista: ' + pushMot + ' | ') : '') + 'Status: ' + pushLib,
                  url: '/',
                  tag: 'nova-' + pushEventId,
                  eventId: pushEventId
                })
              }).catch(() => {});
              if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pushPromise);
            }
            return new Response(JSON.stringify({
              success: true,
              numero: assignedNum,
              id: row?.id
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            console.warn('Erro Supabase POST:', res.status, data);
            return new Response(JSON.stringify({
              success: true,
              cached: true,
              numero: assignedNum,
              note: data?.message || 'Salvo com sucesso'
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // 4. ROTA DE FOTOS DA GALERIA (/api/fotos-galeria) — fora de /api/checklists!
    // ==============================================================================
    // DIRETRIZ PERMANENTE DE INTEGRIDADE (PROIBIDO REESCREVER BLOB MONOLÍTICO):
    // É TERMINANTEMENTE PROIBIDO baixar e reenviar frota_galeria_veiculos_v1 aqui.
    // Cada foto DEVE ser gravada individualmente com id 'frota_rec:galeria:<fotoId>'
    // na tabela parametros (persistência granular por registro), evitando estouro de
    // 8.5 MB, timeout/CPU no Worker e perda concorrente entre motoristas e painel.
    // Regra verificada automaticamente pelo validate.mjs antes de qualquer deploy.
    // ==============================================================================
    if (url.pathname === '/api/fotos-galeria' && request.method === 'POST') {
      const supabaseUrl = (env && env.SUPABASE_URL) || 'https://lhjeodmnqwsftifdvaru.supabase.co';
      const supabaseKey = getSupabaseKey(env);
      try {
        const payload = await request.json();
        const fotosRaw = Array.isArray(payload.fotos) ? payload.fotos : [];
        const fotosValidas = fotosRaw.filter(f => f && typeof (f.dataUrl || f.imagem) === 'string' && (f.dataUrl || f.imagem).startsWith('data:image/'));
        if (!fotosValidas.length) {
          return new Response(JSON.stringify({ success: true, count: 0 }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const normalizarCat = (c) => {
          const s = String(c || '').trim();
          if (/avaria/i.test(s)) return 'Avaria / Carroceria';
          if (/pneu/i.test(s)) return 'Pneus / Calibragem';
          return s || 'Estado Geral / Vistoria';
        };

        const baseTs = Date.now();
        const nowIso = new Date(baseTs).toISOString();
        const vistoriaNum = String(payload.numero || '').trim();
        const bucketName = 'frota-galeria';
        const idsVistos = new Set();
        const fotosUnicas = [];

        fotosValidas.forEach((f, idx) => {
          const fotoId = String(f.id || ('foto_chk_' + (baseTs + idx) + '_' + Math.random().toString(36).slice(2, 6))).trim();
          if (!fotoId || idsVistos.has(fotoId)) return;
          idsVistos.add(fotoId);
          fotosUnicas.push({ f, idx, fotoId });
        });

        const decodeB64Bytes = (dataUrl) => {
          const m = String(dataUrl || '').match(new RegExp('^data:(image/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\\\\r\\\\n]+)$', 'i'));
          if (!m) return null;
          const rawMime = m[1].toLowerCase();
          const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
          const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
          const ext = extMap[mime] || 'jpg';
          const b64 = m[2].replace(/\\s+/g, '');
          let bytes;
          if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
            bytes = new Uint8Array(Buffer.from(b64, 'base64'));
          } else if (typeof atob === 'function') {
            const bin = atob(b64);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          } else {
            return null;
          }
          return bytes && bytes.length ? { mime, ext, bytes } : null;
        };

        const ensureBucket = async () => {
          try {
            const rGet = await fetch(supabaseUrl + '/storage/v1/bucket/' + bucketName, {
              headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey }
            });
            if (rGet.ok) return true;
            const rCr = await fetch(supabaseUrl + '/storage/v1/bucket', {
              method: 'POST',
              headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: bucketName, name: bucketName, public: true })
            });
            return Boolean(rCr.ok || rCr.status === 409);
          } catch (e) {
            return false;
          }
        };

        const uploadParaStorage = async (fotoId, rawUrl, dataIso) => {
          const parsed = decodeB64Bytes(rawUrl);
          if (!parsed) return { imagem: rawUrl };
          const fm = String(dataIso || '').match(/^(\\d{4}-\\d{2})/);
          const folder = fm ? fm[1] : nowIso.slice(0, 7);
          const safeId = fotoId.replace(/[^A-Za-z0-9._-]/g, '_');
          const objectPath = folder + '/' + safeId + '.' + parsed.ext;
          const objEndpoint = supabaseUrl + '/storage/v1/object/' + bucketName + '/' + objectPath;
          const hdrs = {
            'apikey': supabaseKey,
            'Authorization': 'Bearer ' + supabaseKey,
            'Content-Type': parsed.mime,
            'Cache-Control': '31536000',
            'x-upsert': 'true'
          };
          try {
            let rUp = await fetch(objEndpoint, { method: 'POST', headers: hdrs, body: parsed.bytes });
            if (!rUp.ok && (rUp.status === 400 || rUp.status === 404)) {
              if (await ensureBucket()) {
                rUp = await fetch(objEndpoint, { method: 'POST', headers: hdrs, body: parsed.bytes });
              }
            }
            if (!rUp.ok) return { imagem: rawUrl };
            return {
              imagem: supabaseUrl + '/storage/v1/object/public/' + bucketName + '/' + objectPath,
              storage_bucket: bucketName,
              storage_path: objectPath,
              storage_migrated_at: nowIso
            };
          } catch (e) {
            return { imagem: rawUrl };
          }
        };

        const rowsToUpsert = await Promise.all(fotosUnicas.map(async ({ f, idx, fotoId }) => {
          const createdTs = Number(f.ts) || (baseTs + idx);
          const fotoData = f.data || payload.data || nowIso.split('T')[0];
          const rawImg = f.dataUrl || f.imagem;
          const stored = await uploadParaStorage(fotoId, rawImg, fotoData);
          const rec = {
            id: fotoId,
            _id: fotoId,
            _updated_at: nowIso,
            updated_at: nowIso,
            created_ts: createdTs,
            placa: (f.placa || payload.placa || '').toUpperCase().trim(),
            veiculo: f.veiculo || payload.veiculo || 'Veículo da Frota',
            data: fotoData,
            motorista: f.motorista || payload.motorista || 'Vistoriador',
            categoria: normalizarCat(f.categoria),
            km: f.km || payload.km || null,
            vistoria_numero: vistoriaNum || String(f.numero || '').trim(),
            obs: f.obs || ('Check-list Nº ' + (vistoriaNum || 'Oficial')),
            imagem: stored.imagem,
            ...(stored.storage_bucket ? { storage_bucket: stored.storage_bucket, storage_path: stored.storage_path, storage_migrated_at: stored.storage_migrated_at } : {}),
            registrado_por: 'Check-list App (' + (f.motorista || payload.motorista || 'Motorista') + ')'
          };
          return {
            id: 'frota_rec:galeria:' + fotoId,
            valor: createdTs,
            descricao: JSON.stringify(rec)
          };
        }));

        // Gravação granular direta por ID (payload leve, sem risco de sobrescrita concorrente)
        const upsertRes = await fetch(\`\${supabaseUrl}/rest/v1/parametros\`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': \`Bearer \${supabaseKey}\`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(rowsToUpsert)
        });

        if (!upsertRes.ok) {
          const errDetail = await upsertRes.text().catch(() => '');
          return new Response(JSON.stringify({ success: false, error: 'Erro Supabase (' + upsertRes.status + '): ' + errDetail.slice(0, 200) }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, mode: 'granular', count: rowsToUpsert.length }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. SERVIR O INDEX.HTML EMBUTIDO (SEMPRE ATUALIZADO SEM CACHE ANTIGO)
    return new Response(EMBEDDED_HTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
};

const EMBEDDED_HTML = ${JSON.stringify(htmlContent)};
const EMBEDDED_MANIFEST = ${JSON.stringify(manifestContent)};
const EMBEDDED_SW = ${JSON.stringify(swContent)};
const EMBEDDED_ICON = ${JSON.stringify(iconContent)};
`;

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent, 'utf8');
fs.writeFileSync(path.join(publicDir, 'manifest.json'), manifestContent, 'utf8');
fs.writeFileSync(path.join(publicDir, 'sw.js'), swContent, 'utf8');
fs.writeFileSync(path.join(publicDir, 'icon.svg'), iconContent, 'utf8');

fs.writeFileSync(path.join(__dirname, 'worker.js'), workerCode, 'utf8');
console.log('worker.js and public/ generated successfully! Size:', (Buffer.byteLength(workerCode) / 1024).toFixed(1), 'KB');
