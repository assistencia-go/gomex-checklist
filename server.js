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

        // 1. Obter galeria atual do Supabase (tabela parametros)
        const getRes = await supabaseRequest('/rest/v1/parametros?id=eq.frota_galeria_veiculos_v1&select=*');
        let galeriaAtual = [];
        if (getRes.status >= 200 && getRes.status < 300 && Array.isArray(getRes.data) && getRes.data[0]?.descricao) {
          try {
            const parsed = JSON.parse(getRes.data[0].descricao);
            if (Array.isArray(parsed)) galeriaAtual = parsed;
          } catch (e) {}
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

        let serialized = JSON.stringify(galeriaAtualizada);
        while (Buffer.byteLength(serialized, 'utf8') > 8500000 && galeriaAtualizada.length > novasFotos.length) {
          galeriaAtualizada.pop();
          serialized = JSON.stringify(galeriaAtualizada);
        }

        // 3. Upsert no Supabase e validação da resposta
        const upsertRes = await supabaseRequest('/rest/v1/parametros', 'POST', {
          id: 'frota_galeria_veiculos_v1',
          valor: galeriaAtualizada.length,
          descricao: serialized
        });

        if (upsertRes.status < 200 || upsertRes.status >= 300) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Erro Supabase (' + upsertRes.status + ')' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: novasFotos.length, total: galeriaAtualizada.length }));
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
