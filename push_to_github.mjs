// ==============================================================================
// SCRIPT DE PUSH AUTOMÁTICO PARA O GITHUB (GOMEX-CHECKLIST)
// ==============================================================================
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// O token do GitHub NUNCA fica escrito no codigo.
// Informe via variavel de ambiente GITHUB_TOKEN ou no arquivo local .env (ignorado pelo Git).
function carregarTokenGithub() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*GITHUB_TOKEN\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return '';
}

const GITHUB_TOKEN = carregarTokenGithub();
const REPO_OWNER = 'assistencia-go';
const TARGET_REPO = process.env.REPO_NAME || 'gomex-checklist';

const headers = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'Gomex-Sync-Script',
  'Content-Type': 'application/json'
};

const FILES_TO_PUSH = [
  'index.html',
  'server.js',
  'generate_worker.js',
  'validate.mjs',
  'push_to_github.mjs',
  'schema.sql',
  'package.json',
  'README.md',
  '.env.example',
  '.gitignore',
  'wrangler.toml',
  'wrangler.json',
  'worker.js',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'public/index.html',
  'public/manifest.json',
  'public/sw.js',
  'public/icon.svg',
  '.github/workflows/build-apk.yml'
];

async function pushFile(fileName) {
  const baseName = path.basename(fileName);
  if (baseName === '.env' || (baseName.startsWith('.env.') && baseName !== '.env.example')) {
    throw new Error(`[BLOQUEIO DE SEGURANCA] Tentativa de enviar arquivo secreto bloqueada: ${fileName}`);
  }

  const localPath = path.join(__dirname, fileName);
  if (!fs.existsSync(localPath)) {
    console.warn(`Arquivo nao encontrado: ${fileName}`);
    return;
  }

  const content = fs.readFileSync(localPath);
  const textSample = content.toString('utf8');
  if (/github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+/.test(textSample)) {
    throw new Error(`[BLOQUEIO DE SEGURANCA] Token GitHub detectado no arquivo ${fileName}. Push abortado!`);
  }

  const base64Content = content.toString('base64');
  const gitHubPath = fileName.replace(/\\/g, '/');
  const url = `https://api.github.com/repos/${REPO_OWNER}/${TARGET_REPO}/contents/${gitHubPath}`;

  let success = false;
  for (let attempt = 1; attempt <= 3 && !success; attempt++) {
    try {
      let sha = null;
      try {
        const getRes = await fetch(url, { headers });
        if (getRes.ok) {
          const getData = await getRes.json();
          sha = getData.sha;
        }
      } catch (e) {}

      const payload = {
        message: `feat(checklist): tornar fotos de carroceria e pneus obrigatorias (${fileName})`,
        content: base64Content,
        branch: 'main'
      };
      if (sha) payload.sha = sha;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });

      if (putRes.ok) {
        const resData = await putRes.json();
        console.log(`[OK] [GitHub] ${fileName} enviado com sucesso! Commit: ${resData.commit?.sha?.slice(0, 7)}`);
        success = true;
      } else {
        const errText = await putRes.text();
        console.error(`[ERRO] [GitHub] Tentativa ${attempt} falhou para ${fileName}: ${putRes.status} - ${errText}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.warn(`[FALHA] [GitHub] Tentativa ${attempt} erro de conexao para ${fileName}: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('[BLOQUEIO] Token do GitHub nao configurado. Defina GITHUB_TOKEN ou adicione no arquivo .env.');
    process.exit(1);
  }

  console.log('[BUILD] Compilando worker.js e sincronizando public/...');
  try {
    execSync('node generate_worker.js', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.error('[ERRO] Falha ao compilar worker:', err.message);
    process.exit(1);
  }

  console.log('[SEGURANCA] Executando bateria completa de validacao pre-deploy...');
  try {
    execSync('node validate.mjs', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.error('\n[BLOQUEIO CRITICO] Envio para o GitHub CANCELADO porque a validacao reprovou.\n');
    process.exit(1);
  }

  console.log(`\n[START] Enviando projeto seguro para: https://github.com/${REPO_OWNER}/${TARGET_REPO}`);
  for (const file of FILES_TO_PUSH) {
    await pushFile(file);
  }
  console.log(`\n[CONCLUIDO] Projeto enviado com sucesso para: https://github.com/${REPO_OWNER}/${TARGET_REPO}\n`);
}

main().catch(err => {
  console.error('[ERRO FATAL]', err);
  process.exit(1);
});
