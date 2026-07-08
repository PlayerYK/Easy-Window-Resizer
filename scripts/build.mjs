import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const outputDir = path.join(distDir, 'Easy-window-resizer');
const manifestPath = path.join(sourceDir, 'manifest.json');

const runtimeEntries = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'i18n.js',
  '_locales',
  'images'
];

async function readJson(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return JSON.parse(source);
}

function bumpVersion(version) {
  const parts = version.split('.');
  if (
    parts.length < 1 ||
    parts.length > 4 ||
    parts.some(part => !/^\d+$/.test(part))
  ) {
    throw new Error(`Unsupported manifest version: ${version}`);
  }

  while (parts.length < 3) {
    parts.push('0');
  }

  const lastIndex = parts.length - 1;
  parts[lastIndex] = String(Number(parts[lastIndex]) + 1);
  return parts.join('.');
}

async function getNextManifest() {
  const manifest = await readJson(manifestPath);
  const currentVersion = manifest.version;
  const nextVersion = bumpVersion(currentVersion);

  manifest.version = nextVersion;
  return { manifest, currentVersion, nextVersion };
}

async function copyRuntimeEntry(entry) {
  const source = path.join(sourceDir, entry);
  const target = path.join(outputDir, entry);
  await copyFiltered(source, target);
}

async function copyFiltered(source, target) {
  const name = path.basename(source);
  if (name === '.DS_Store') {
    return;
  }

  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    const children = await fs.readdir(source);
    for (const child of children) {
      await copyFiltered(path.join(source, child), path.join(target, child));
    }
    return;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function build() {
  const { manifest, currentVersion, nextVersion } = await getNextManifest();

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const entry of runtimeEntries) {
    if (entry === 'manifest.json') {
      continue;
    }
    await copyRuntimeEntry(entry);
  }

  const manifestSource = `${JSON.stringify(manifest, null, 4)}\n`;
  await fs.writeFile(manifestPath, manifestSource);
  await fs.writeFile(path.join(outputDir, 'manifest.json'), manifestSource);

  console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);
  console.log(`Build output: ${path.relative(rootDir, outputDir)}`);
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
