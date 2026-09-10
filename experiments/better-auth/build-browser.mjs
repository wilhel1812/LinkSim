import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildBrowser() {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const result = buildSync({ absWorkingDir: directory, entryPoints: ['browser.mjs'],
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022' });
  const page = readFileSync(new URL('./browser.html', import.meta.url), 'utf8');
  mkdirSync(new URL('./.wrangler', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.wrangler/browser-module.mjs', import.meta.url),
    `export const page = ${JSON.stringify(page)};\nexport const script = ${JSON.stringify(result.outputFiles[0].text)};\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildBrowser();
