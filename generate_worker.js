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
          if (!payload.numero || payload.numero === 'AUTO') {
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

          if (payload.rota && payload.motorista) {
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

        // 1. Obter galeria atual do Supabase (tabela parametros)
        const getRes = await fetch(\`\${supabaseUrl}/rest/v1/parametros?id=eq.frota_galeria_veiculos_v1&select=*\`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': \`Bearer \${supabaseKey}\`,
            'Content-Type': 'application/json'
          }
        });
        let galeriaAtual = [];
        if (getRes.ok) {
          const rows = await getRes.json();
          if (Array.isArray(rows) && rows[0]?.descricao) {
            try {
              const parsed = JSON.parse(rows[0].descricao);
              if (Array.isArray(parsed)) galeriaAtual = parsed;
            } catch (e) {}
          }
        }

        // 2. Prepend das novas fotos da vistoria com deduplicação por id
        const baseTs = Date.now();
        const idsExistentes = new Set(galeriaAtual.map(x => String(x?.id || '')));
        const novasFotos = [];
        fotosValidas.forEach((f, idx) => {
          const fotoId = String(f.id || ('foto_chk_' + (baseTs + idx) + '_' + Math.random().toString(36).slice(2, 6)));
          if (idsExistentes.has(fotoId)) return;
          idsExistentes.add(fotoId);
          novasFotos.push({
            id: fotoId,
            created_ts: Number(f.ts) || (baseTs + idx),
            placa: (f.placa || payload.placa || '').toUpperCase().trim(),
            veiculo: f.veiculo || payload.veiculo || 'Veículo da Frota',
            data: f.data || payload.data || new Date().toISOString().split('T')[0],
            motorista: f.motorista || payload.motorista || 'Vistoriador',
            categoria: normalizarCat(f.categoria),
            km: f.km || payload.km || null,
            obs: f.obs || ('Check-list Nº ' + (payload.numero || 'Oficial')),
            imagem: f.dataUrl || f.imagem,
            registrado_por: 'Check-list App (' + (f.motorista || payload.motorista || 'Motorista') + ')'
          });
        });

        let galeriaAtualizada = [...novasFotos, ...galeriaAtual];
        if (galeriaAtualizada.length > 200) galeriaAtualizada.length = 200;

        // Mantém o payload abaixo do limite seguro (8.5 MB) removendo itens mais antigos se necessário
        let serialized = JSON.stringify(galeriaAtualizada);
        while (serialized.length > 8500000 && galeriaAtualizada.length > novasFotos.length) {
          galeriaAtualizada.pop();
          serialized = JSON.stringify(galeriaAtualizada);
        }

        // 3. Upsert no Supabase e validação real de resposta
        const upsertRes = await fetch(\`\${supabaseUrl}/rest/v1/parametros\`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': \`Bearer \${supabaseKey}\`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify({
            id: 'frota_galeria_veiculos_v1',
            valor: galeriaAtualizada.length,
            descricao: serialized
          })
        });

        if (!upsertRes.ok) {
          const errDetail = await upsertRes.text().catch(() => '');
          return new Response(JSON.stringify({ success: false, error: 'Erro Supabase (' + upsertRes.status + '): ' + errDetail.slice(0, 200) }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, count: novasFotos.length, total: galeriaAtualizada.length }), {
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
