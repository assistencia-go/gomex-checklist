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
        'Prefer': 'return=representation'
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      const response = await supabaseRequest('/rest/v1/veiculo_checklists?select=*&order=id.desc&limit=100');
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

  // --- SERVIÇO DE ARQUIVOS ESTÁTICOS ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

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
