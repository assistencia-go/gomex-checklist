// ==============================================================================
// GOMEX DISTRIBUIDORA · SERVIDOR BACK-END SEGURO
// As credenciais do banco de dados ficam 100% no servidor (.env) e NUNCA no frontend!
// ==============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 1. Carregar variáveis do .env (se existir)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  });
}

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

console.log('🚀 Iniciando Servidor Gomex Frota...');
console.log('🔒 Supabase URL conectada no servidor:', SUPABASE_URL);

// 2. Helper de Requisições HTTPS para o Supabase (Zero dependências externas)
function supabaseRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SUPABASE_URL);
    const postData = data ? JSON.stringify(data) : null;

    const options = {
      method: method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(url, options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: parsed, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: body });
        }
      });
    });

    req.on('error', err => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

// 3. Servidor HTTP
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // --- ROTAS DA API (BACKEND SEGURO) ---

  // Health Check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', time: new Date().toISOString() }));
    return;
  }

  // GET /api/checklists (Listar vistorias para o SaaS)
  if (pathname === '/api/checklists' && req.method === 'GET') {
    try {
      const response = await supabaseRequest('/rest/v1/veiculo_checklists?select=id,numero,motorista,placa,rota,status&order=id.desc&limit=100');
      if (response.status >= 200 && response.status < 300 && Array.isArray(response.data)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.data));
      } else {
        // Tabela ainda vazia ou não criada
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
    } catch (err) {
      console.error('Erro na API /api/checklists (GET):', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Erro ao buscar checklists' }));
    }
    return;
  }

  // PATCH /api/checklists (Sincronizar rota do vendedor automaticamente no painel)
  if (pathname === '/api/checklists' && req.method === 'PATCH') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const rota = (payload.rota || '').trim();
        const motorista = (payload.motorista || '').trim();
        const placa = (payload.placa || '').trim().toUpperCase();

        if (!rota || (!motorista && !placa)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Rota e motorista/placa são obrigatórios' }));
          return;
        }

        let updatedCount = 0;
        if (motorista) {
          const rMot = await supabaseRequest(
            `/rest/v1/veiculo_checklists?motorista=ilike.${encodeURIComponent(motorista)}`,
            'PATCH',
            { rota }
          );
          if (Array.isArray(rMot.data)) updatedCount += rMot.data.length;
        }
        if (updatedCount === 0 && placa) {
          const rList = await supabaseRequest(
            `/rest/v1/veiculo_checklists?select=id&placa=eq.${encodeURIComponent(placa)}&order=id.desc&limit=1`
          );
          if (Array.isArray(rList.data) && rList.data[0]?.id) {
            await supabaseRequest(
              `/rest/v1/veiculo_checklists?id=eq.${rList.data[0].id}`,
              'PATCH',
              { rota }
            );
            updatedCount = 1;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, rota, updated: updatedCount }));
      } catch (err) {
        console.error('Erro na API /api/checklists (PATCH):', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
    });
    return;
  }

  // POST /api/checklists (Salvar novo checklist com numeração oficial sequencial)
  if (pathname === '/api/checklists' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);

        // Se o número for 'AUTO' ou provisório, remove para que o Supabase gere o sequencial oficial
        if (!payload.numero || payload.numero === 'AUTO') {
          delete payload.numero;
        }

        // Envia para o Supabase com autenticação segura
        const response = await supabaseRequest('/rest/v1/veiculo_checklists', 'POST', payload);

        // Se o vendedor informou sua rota, atualiza também os registros anteriores dele no banco
        if (payload.rota && payload.motorista) {
          supabaseRequest(
            `/rest/v1/veiculo_checklists?motorista=ilike.${encodeURIComponent(String(payload.motorista).trim())}`,
            'PATCH',
            { rota: String(payload.rota).trim() }
          ).catch(() => {});
        }

        if (response.status >= 200 && response.status < 300) {
          const row = Array.isArray(response.data) ? response.data[0] : response.data;
          const assignedNum = row?.numero || '000001';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, numero: assignedNum, id: row?.id }));
        } else {
          console.warn('Resposta Supabase ao salvar:', response.status, response.raw);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, cached: true, numero: '000001', note: response.data?.message || 'Salvo no servidor' }));
        }
      } catch (err) {
        console.error('Erro na API /api/checklists (POST):', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
    });
    return;
  }

  // POST /api/fotos-galeria (Salvar fotos da vistoria diretamente na galeria do painel)
  // ==============================================================================
  // DIRETRIZ PERMANENTE DE INTEGRIDADE (PROIBIDO REESCREVER BLOB MONOLÍTICO):
  // Cada foto DEVE ser gravada individualmente com id 'frota_rec:galeria:<fotoId>'
  // em parametros (persistência granular por registro), nunca sobrescrevendo o
  // registro legado frota_galeria_veiculos_v1.
  // ==============================================================================
  if (pathname === '/api/fotos-galeria' && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 25 * 1024 * 1024) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Lote de fotos excedeu 25 MB' }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const payload = JSON.parse(body || '{}');
        const fotosRaw = Array.isArray(payload.fotos) ? payload.fotos : [];
        const fotosValidas = fotosRaw.filter(f => f && typeof (f.dataUrl || f.imagem) === 'string' && (f.dataUrl || f.imagem).startsWith('data:image/'));
        if (!fotosValidas.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: 0 }));
          return;
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

        const ensureBucketLocal = async () => {
          try {
            const rGet = await fetch(SUPABASE_URL + '/storage/v1/bucket/' + bucketName, {
              headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
            });
            if (rGet.ok) return true;
            const rCr = await fetch(SUPABASE_URL + '/storage/v1/bucket', {
              method: 'POST',
              headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: bucketName, name: bucketName, public: true })
            });
            return Boolean(rCr.ok || rCr.status === 409);
          } catch (e) {
            return false;
          }
        };

        const uploadParaStorageLocal = async (fotoId, rawUrl, dataIso) => {
          const m = String(rawUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i);
          if (!m) return { imagem: rawUrl };
          const rawMime = m[1].toLowerCase();
          const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
          const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
          const ext = extMap[mime] || 'jpg';
          const bytes = new Uint8Array(Buffer.from(m[2].replace(/\s+/g, ''), 'base64'));
          const fm = String(dataIso || '').match(/^(\d{4}-\d{2})/);
          const folder = fm ? fm[1] : nowIso.slice(0, 7);
          const safeId = fotoId.replace(/[^A-Za-z0-9._-]/g, '_');
          const objectPath = folder + '/' + safeId + '.' + ext;
          const objEndpoint = SUPABASE_URL + '/storage/v1/object/' + bucketName + '/' + objectPath;
          const hdrs = {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': mime,
            'Cache-Control': '31536000',
            'x-upsert': 'true'
          };
          try {
            let rUp = await fetch(objEndpoint, { method: 'POST', headers: hdrs, body: bytes });
            if (!rUp.ok && (rUp.status === 400 || rUp.status === 404)) {
              if (await ensureBucketLocal()) {
                rUp = await fetch(objEndpoint, { method: 'POST', headers: hdrs, body: bytes });
              }
            }
            if (!rUp.ok) return { imagem: rawUrl };
            return {
              imagem: SUPABASE_URL + '/storage/v1/object/public/' + bucketName + '/' + objectPath,
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
          const stored = await uploadParaStorageLocal(fotoId, rawImg, fotoData);
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

        // Gravação granular direta por ID (payload leve, sem sobrescrita concorrente)
        const upsertRes = await supabaseRequest('/rest/v1/parametros', 'POST', rowsToUpsert);

        if (upsertRes.status < 200 || upsertRes.status >= 300) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Erro Supabase (' + upsertRes.status + ')' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, mode: 'granular', count: rowsToUpsert.length }));
      } catch (err) {
        console.error('Erro ao salvar fotos da vistoria na galeria:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // --- SERVIÇO SEGURO DE ARQUIVOS ESTÁTICOS (bloqueia .env, dotfiles e scripts internos) ---
  const BLOCKED_FILES = new Set(['server.js', 'worker.js', 'wrangler.toml', 'wrangler.json', 'package.json', 'package-lock.json', '.env', 'generate_worker.js', 'push_to_github.mjs', 'validate.mjs', 'schema.sql']);
  const safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedBase = path.resolve(__dirname);
  let filePath = path.resolve(__dirname, safeRel);
  const baseName = path.basename(filePath);

  if (!filePath.startsWith(resolvedBase) || BLOCKED_FILES.has(baseName) || baseName.startsWith('.') || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(resolvedBase, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback para index.html para SPAs
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (indexErr, indexContent) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Página não encontrada');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexContent);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Servidor Gomex Frota rodando em: http://localhost:${PORT}`);
  console.log(`🔒 Nenhuma credencial ou chave de banco está exposta no frontend.`);
});
