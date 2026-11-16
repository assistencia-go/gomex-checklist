// ==============================================================================
// GOMEX FROTA CHECK-LIST · PIPELINE DE VALIDAÇÃO E SEGURANÇA PRÉ-DEPLOY
// ==============================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function logPass(msg) { console.log(`${COLORS.green}[PASS]${COLORS.reset} ${msg}`); }
function logFail(msg) { console.error(`${COLORS.red}[FAIL]${COLORS.reset} ${COLORS.bold}${msg}${COLORS.reset}`); }

let hasError = false;

console.log(`\n${COLORS.bold}--- 1. Validando Integridade e Segurança do index.html ---${COLORS.reset}`);
const indexPath = path.join(__dirname, 'index.html');
let indexContent = '';

if (!fs.existsSync(indexPath)) {
  logFail('Arquivo index.html nao encontrado!');
  hasError = true;
} else {
  indexContent = fs.readFileSync(indexPath, 'utf8');
  const sizeKb = Buffer.byteLength(indexContent, 'utf8') / 1024;
  if (sizeKb < 100) {
    logFail(`Tamanho suspeito do index.html: ${sizeKb.toFixed(1)} KB`);
    hasError = true;
  } else {
    logPass(`Tamanho do index.html verificado: ${sizeKb.toFixed(1)} KB.`);
  }

  if (!indexContent.toLowerCase().includes('<!doctype html>') || !indexContent.trim().endsWith('</html>')) {
    logFail('Estrutura HTML incompleta (doctype ou </html> ausente).');
    hasError = true;
  } else {
    logPass('Estrutura HTML completa (doctype ate </html>).');
  }

  // Verificar IDs e handlers referenciados
  const ids = new Set([...indexContent.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
  const refs = [...indexContent.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map(m => m[1]);
  const allowedDynamic = new Set(['sysToastContainer', 'introDatePill']);
  const missingIds = [...new Set(refs)].filter(r => !ids.has(r) && !allowedDynamic.has(r));
  if (missingIds.length) {
    logFail(`Elementos DOM referenciados por getElementById mas ausentes no HTML: ${missingIds.join(', ')}`);
    hasError = true;
  } else {
    logPass('Todos os IDs DOM referenciados existem no HTML.');
  }

  // Verificar politica zero-emoji no HTML
  const emojiMatches = indexContent.match(/\p{Extended_Pictographic}/gu);
  if (emojiMatches && emojiMatches.length > 0) {
    logFail(`Politica Zero-Emoji violada no index.html (${emojiMatches.length} encontrado(s)).`);
    hasError = true;
  } else {
    logPass('Politica Zero-Emoji cumprida no index.html.');
  }

  // Verificar sintaxe AST do script interno
  const scriptMatch = indexContent.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) {
    logFail('Script principal nao encontrado no index.html.');
    hasError = true;
  } else {
    try {
      new vm.Script(scriptMatch[1]);
      logPass('Sintaxe JavaScript interna do index.html 100% valida (AST sem erros).');
    } catch (err) {
      logFail(`Erro de sintaxe no <script> do index.html: ${err.message}`);
      hasError = true;
    }
  }
}

console.log(`\n${COLORS.bold}--- 2. Validando Sintaxe dos Arquivos JavaScript e Seguranca de Tokens ---${COLORS.reset}`);
const jsFilesToCheck = [
  'server.js',
  'generate_worker.js',
  'sw.js',
  'public/sw.js',
  'worker.js',
  'push_to_github.mjs'
];
for (const file of jsFilesToCheck) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    logFail(`Arquivo obrigatorio ausente: ${file}`);
    hasError = true;
    continue;
  }
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    const txt = fs.readFileSync(filePath, 'utf8');
    if (/github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+/.test(txt)) {
      logFail(`Token GitHub exposto detectado no codigo-fonte: ${file}`);
      hasError = true;
    } else {
      logPass(`Sintaxe valida e sem segredos expostos: ${file}`);
    }
  } catch (err) {
    logFail(`Erro de sintaxe em ${file}: ${err.stderr ? err.stderr.toString() : err.message}`);
    hasError = true;
  }
}

console.log(`\n${COLORS.bold}--- 3. Validando Roteamento Real do Worker (/api/fotos-galeria) ---${COLORS.reset}`);
try {
  const workerSrc = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  const transformed = workerSrc.replace(/export\s+default\s+/, 'const __worker = ') + '\n__worker;';
  const workerCalls = [];
  const workerCtx = {
    URL,
    Response: class MockResponse {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.headers = init.headers || {};
      }
      async json() { return JSON.parse(this.body); }
      async text() { return String(this.body); }
    },
    fetch: async (url, opts = {}) => {
      workerCalls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
      if (String(url).includes('parametros?id=eq.frota_galeria_veiculos_v1')) {
        return { ok: true, status: 200, json: async () => ([{ id: 'frota_galeria_veiculos_v1', descricao: '[]' }]) };
      }
      return { ok: true, status: 200, json: async () => ([{ id: 'frota_galeria_veiculos_v1' }]), text: async () => '[]' };
    },
    atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
    Buffer,
    console
  };
  const workerObj = vm.runInNewContext(transformed, workerCtx);
  const reqTest = {
    url: 'https://gomex-checklist.gomexassistencia2026.workers.dev/api/fotos-galeria',
    method: 'POST',
    json: async () => ({
      placa: 'ABC1D23',
      veiculo: 'Kombi',
      motorista: 'Teste',
      data: '2026-11-16',
      km: 12000,
      numero: '000999',
      fotos: [{ id: 'f1', categoria: 'Pneus e Rodas', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }]
    })
  };
  const resTest = await workerObj.fetch(reqTest, {}, {});
  const resJson = await resTest.json();
  const upsertCall = workerCalls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/parametros'));
  if (!resJson.success || resJson.count !== 1 || !upsertCall) {
    throw new Error(`Worker /api/fotos-galeria nao salvou no Supabase: ${JSON.stringify(resJson)}`);
  }
  const savedPayload = JSON.parse(upsertCall.body);
  const savedGallery = JSON.parse(savedPayload.descricao);
  if (savedGallery[0].categoria !== 'Pneus / Calibragem' || savedGallery[0].placa !== 'ABC1D23') {
    throw new Error(`Formato incompativel com painel: ${JSON.stringify(savedGallery[0])}`);
  }
  logPass('Rota /api/fotos-galeria no worker.js validada ponta-a-ponta (chega no Supabase no formato do painel).');
} catch (err) {
  logFail(`Falha na validacao da rota /api/fotos-galeria do worker: ${err.message}`);
  hasError = true;
}

console.log(`\n${COLORS.bold}--- 4. Executando Smoke Test Headless do Checklist (Etapas, Fotos & Cache) ---${COLORS.reset}`);
try {
  const scriptMatch = indexContent.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  const storageMap = {};
  const mockStorage = {
    getItem: (k) => (k in storageMap ? storageMap[k] : null),
    setItem: (k, v) => { storageMap[k] = String(v); },
    removeItem: (k) => { delete storageMap[k]; }
  };

  const listenersMap = {};
  const makeEl = (id = '') => {
    const el = {
      id,
      value: '',
      name: '',
      type: '',
      checked: false,
      style: {},
      dataset: {},
      innerHTML: '',
      textContent: '',
      files: null,
      children: [],
      parentNode: null,
      classList: {
        _set: new Set(),
        add(...a) { a.forEach(x => this._set.add(x)); },
        remove(...a) { a.forEach(x => this._set.delete(x)); },
        toggle(x, force) {
          if (force === undefined) { if (this._set.has(x)) this._set.delete(x); else this._set.add(x); }
          else if (force) this._set.add(x); else this._set.delete(x);
        },
        contains(x) { return this._set.has(x); }
      },
      addEventListener(ev, fn) {
        if (!listenersMap[id]) listenersMap[id] = {};
        if (!listenersMap[id][ev]) listenersMap[id][ev] = [];
        listenersMap[id][ev].push(fn);
      },
      appendChild(child) { child.parentNode = el; el.children.push(child); },
      removeChild(child) { el.children = el.children.filter(c => c !== child); },
      remove() {},
      click() {},
      focus() {},
      scrollIntoView() {},
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      closest: () => makeEl(),
      getBoundingClientRect: () => ({ width: 300, height: 180, left: 0, top: 0 }),
      getContext: () => ({
        scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        fillRect() {}, drawImage() {}, fillStyle: ''
      }),
      toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      setAttribute() {},
      cloneNode: () => makeEl()
    };
    return el;
  };

  const els = {
    frm: Object.assign(makeEl('frm'), {
      elements: [],
      reset() {},
      data: { value: '' },
      hora: { value: '' }
    }),
    inpFotoCamera: makeEl('inpFotoCamera'),
    inpFotoGaleria: makeEl('inpFotoGaleria'),
    previewAvariasFotos: makeEl('previewAvariasFotos'),
    previewPneusFotos: makeEl('previewPneusFotos'),
    previewRevisaoFotos: makeEl('previewRevisaoFotos'),
    contBadge: makeEl('contBadge'),
    avariasCount: makeEl('avariasCount'),
    stepBadge: makeEl('stepBadge'),
    stepTitle: makeEl('stepTitle'),
    stepProgressFill: makeEl('stepProgressFill'),
    reviewSummaryContent: makeEl('reviewSummaryContent'),
    offlinePhotosBanner: makeEl('offlinePhotosBanner'),
    offlinePhotosTxt: makeEl('offlinePhotosTxt'),
    cameraModal: makeEl('cameraModal')
  };

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, RegExp, Error, Promise,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    navigator: { userAgent: 'Checklist-Smoke-Test' },
    location: { protocol: 'https:', hostname: 'gomex-checklist.gomexassistencia2026.workers.dev', port: '', pathname: '/' },
    localStorage: mockStorage,
    window: null,
    document: {
      readyState: 'complete',
      body: makeEl('body'),
      getElementById: (id) => els[id] || (els[id] = makeEl(id)),
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener: () => {}
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
    Image: class MockImg {
      set src(_) { this.naturalWidth = 800; this.naturalHeight = 600; this.width = 800; this.height = 600; if (this.onload) this.onload(); }
    },
    jspdf: { jsPDF: class {} }
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.window.addEventListener = () => {};

  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  logPass('Script inicializado sem erros de execucao.');

  // 1) Verifica se listeners de inpFotoCamera e inpFotoGaleria foram registrados na inicializacao!
  if (!(listenersMap.inpFotoCamera?.change?.length) || !(listenersMap.inpFotoGaleria?.change?.length)) {
    throw new Error('Listeners de inpFotoCamera ou inpFotoGaleria nao foram registrados no boot!');
  }
  logPass('Listeners de camera e galeria registrados na inicializacao (fora de limparFormulario).');

  // 2) Verifica refreshProgresso sem progBar (nao pode lancar TypeError)
  sandbox.refreshProgresso();
  logPass('refreshProgresso() executado sem erros com DOM atual.');

  // 3) Verifica compressao, preview e remocao de fotos
  const dataUrlSim = await sandbox.comprimirFoto({ name: 'pneu.jpg', type: 'image/jpeg', size: 1024 });
  if (!String(dataUrlSim).startsWith('data:image/jpeg')) {
    throw new Error('comprimirFoto nao gerou JPEG valido.');
  }
  await sandbox.onFotosSelecionadas([{ name: 'avaria.jpg', type: 'image/jpeg', size: 2048 }]);
  if (!els.previewAvariasFotos.innerHTML.includes('photo-preview-item')) {
    throw new Error('Preview de foto nao renderizado em previewAvariasFotos.');
  }
  logPass('Compressao e preview de fotos validados.');

  // 4) Verifica limite de cache local para nao ocorrer QuotaExceededError
  for (let i = 0; i < 15; i++) {
    sandbox.salvarNoCacheLocal({ numero: String(i), placa: 'ABC1D23', ass_motorista: 'data:image/png;base64,AAA' });
  }
  const cacheSalvo = JSON.parse(storageMap['gomex_checklists_cache_v1'] || '[]');
  if (cacheSalvo.length > 10 || cacheSalvo[5].ass_motorista !== null) {
    throw new Error('Cache local nao esta podando registros antigos/assinaturas pesadas.');
  }
  logPass('Protecao contra estouro de armazenamento local (QuotaExceededError) validada.');

  // 5) Verifica limparFormulario e resumo de revisao
  sandbox.renderizarResumoRevisao();
  sandbox.limparFormulario();
  if (els.previewAvariasFotos.innerHTML !== '') {
    throw new Error('limparFormulario nao limpou as fotos da vistoria.');
  }
  logPass('renderizarResumoRevisao() e limparFormulario() executados com sucesso.');
} catch (err) {
  logFail(`Falha no Smoke Test headless: ${err.message}`);
  console.error(err.stack || err);
  hasError = true;
}

console.log(`\n${COLORS.bold}--- 5. Validando Compilacao Cloudflare Wrangler ---${COLORS.reset}`);
try {
  const wranglerOutput = execSync('npx wrangler deploy --dry-run', {
    cwd: __dirname,
    stdio: 'pipe',
    shell: true
  }).toString();
  if (wranglerOutput.includes('--dry-run: exiting now.')) {
    logPass('Cloudflare Wrangler validou o worker.js e assets com sucesso.');
  } else {
    logFail('Wrangler nao concluiu a verificacao de forma limpa.');
    hasError = true;
  }
} catch (err) {
  logFail(`Falha na validacao do Wrangler: ${err.stderr ? err.stderr.toString() : err.message}`);
  hasError = true;
}

console.log(`\n${COLORS.bold}--- 6. Criando Snapshot de Backup Seguro ---${COLORS.reset}`);
try {
  const backupsDir = path.join(__dirname, '.backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(backupsDir, `backup_${timestamp}`);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const f of ['index.html', 'worker.js', 'generate_worker.js', 'server.js', 'sw.js']) {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetDir, f));
  }
  const all = fs.readdirSync(backupsDir).filter(n => n.startsWith('backup_')).sort();
  if (all.length > 15) {
    for (const old of all.slice(0, all.length - 15)) {
      fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true });
    }
  }
  logPass(`Backup de seguranca gerado: .backups/backup_${timestamp}`);
} catch (err) {
  logFail(`Falha ao gerar backup: ${err.message}`);
}

console.log('\n' + '='.repeat(60));
if (hasError) {
  console.error(`${COLORS.red}${COLORS.bold}[BLOQUEIO] Validacao reprovada! Corrija os erros antes de subir.${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');
  process.exit(1);
} else {
  console.log(`${COLORS.green}${COLORS.bold}[APROVADO] Todos os testes passaram! App pronto para producao.${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');
  process.exit(0);
}

