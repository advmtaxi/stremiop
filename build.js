import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function build() {
  console.log('Building and obfuscating codebase...');
  
  // Create dist directory
  const dist = join(__dirname, 'dist');
  await fs.rm(dist, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dist);

  // Use esbuild to bundle EVERYTHING into a single CommonJS file.
  // Wait, if we bundle everything into one file, we can't use Worker with a separate file.
  // So we bundle the worker SEPARATELY.
  
  const workerOptions = {
    entryPoints: [join(__dirname, 'src/goat/lock-worker.js')],
    outfile: join(dist, 'src/goat/lock-worker.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    define: { 'import.meta.url': 'import_meta_url_shim' },
    external: ['worker_threads', 'child_process', 'path', 'url', 'util', 'crypto'],
  };
  
  const mainOptions = {
    entryPoints: [join(__dirname, 'src/server.js')],
    outfile: join(dist, 'src/server.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    define: { 'import.meta.url': 'import_meta_url_shim' },
    external: ['worker_threads', 'child_process', 'path', 'url', 'util', 'crypto'],
  };

  await esbuild.build(workerOptions);
  console.log('Worker bundled.');
  
  await esbuild.build(mainOptions);
  console.log('Main bundled.');

  // Copy WASM files and native files
  await fs.mkdir(join(dist, 'src/goat/vendor'), { recursive: true });
  await fs.copyFile(join(__dirname, 'src/goat/vendor/lock.wasm'), join(dist, 'src/goat/vendor/lock.wasm'));
  await fs.copyFile(join(__dirname, 'src/goat/vendor/lock-esm.mjs'), join(dist, 'src/goat/vendor/lock-esm.mjs'));
  
  // Copy public directory
  await fs.cp(join(__dirname, 'public'), join(dist, 'public'), { recursive: true });
  
  // Inject shim
  console.log('Fixing import.meta.url for CJS...');
  const serverJsPath = join(dist, 'src/server.js');
  const workerJsPath = join(dist, 'src/goat/lock-worker.js');
  const shim = 'const import_meta_url_shim = "file:///" + __filename.replace(/\\\\/g, "/");\n';
  let serverJs = await fs.readFile(serverJsPath, 'utf8');
  let workerJs = await fs.readFile(workerJsPath, 'utf8');
  
  // Inject HTML content directly into serverJs
  const indexHtml = await fs.readFile(join(__dirname, 'public/index.html'), 'utf8');
  serverJs = serverJs.replace('"__INDEX_HTML_PLACEHOLDER__"', JSON.stringify(indexHtml));
  
  // Inject worker code string into serverJs
  serverJs = serverJs.replace('"__WORKER_CODE_PLACEHOLDER__"', () => JSON.stringify(workerJs));
  
  await fs.writeFile(serverJsPath, shim + serverJs);
  await fs.writeFile(workerJsPath, shim + workerJs);
  
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  console.log('Writing package.json for pkg...');
  await fs.writeFile(join(dist, 'package.json'), JSON.stringify({
    name: 'addon',
    bin: 'src/server.js'
  }, null, 2));

  console.log('Compiling to .exe with pkg...');
  await execAsync('npx pkg dist/package.json --target node18-win-x64 --output addon-fixed.exe --assets "dist/src/goat/**/*" --public');
  
  console.log('SUCCESS! addon-fixed.exe has been generated.');
}

build().catch(console.error);
