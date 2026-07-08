import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outputDir = path.join(distDir, 'Easy-window-resizer');
const manifestPath = path.join(outputDir, 'manifest.json');

async function readJson(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return JSON.parse(source);
}

async function removePreviousPackages() {
  let entries = [];
  try {
    entries = await fs.readdir(distDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter(entry => /^Easy-window-resizer-\d+(?:\.\d+){0,3}\.zip$/.test(entry))
      .map(entry => fs.rm(path.join(distDir, entry), { force: true }))
  );
}

async function addDirectoryToZip(zipFile, sourceDir, archiveDir = '') {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const archivePath = archiveDir ? `${archiveDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToZip(zipFile, sourcePath, archivePath);
    } else if (entry.isFile()) {
      zipFile.addFile(sourcePath, archivePath, { compress: true });
    }
  }
}

async function createZip(sourceDir, zipPath) {
  await fs.rm(zipPath, { force: true });

  return new Promise((resolve, reject) => {
    const zipFile = new yazl.ZipFile();
    const output = createWriteStream(zipPath);

    output.on('close', resolve);
    output.on('error', reject);
    zipFile.outputStream.on('error', reject);

    zipFile.outputStream.pipe(output);
    addDirectoryToZip(zipFile, sourceDir)
      .then(() => zipFile.end())
      .catch(reject);
  });
}

async function pack() {
  const manifest = await readJson(manifestPath);
  const zipPath = path.join(distDir, `Easy-window-resizer-${manifest.version}.zip`);

  await removePreviousPackages();
  await createZip(outputDir, zipPath);

  console.log(`Zip package: ${path.relative(rootDir, zipPath)}`);
}

pack().catch(error => {
  console.error(error);
  process.exit(1);
});
