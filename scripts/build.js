import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ApkBuilder } from '../src/apk-builder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function build() {
  const apkBuilder = new ApkBuilder();
  const outApk = path.join(rootDir, 'dist', 'android', 'adb-apt-companion.apk');
  const apkMeta = await apkBuilder.buildCompanionApk({
    packageId: 'com.adbapt.companion',
    appName: 'ADB-APT Companion',
    versionName: '1.0.0',
    versionCode: 1,
    outFile: outApk
  });

  const manifestPath = path.join(rootDir, 'dist', 'android', 'apk-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(apkMeta, null, 2), 'utf8');

  console.log(`[build] Generated Android companion APK: ${apkMeta.apkPath} (${apkMeta.sizeBytes} bytes)`);
  console.log(`[build] SHA-256: ${apkMeta.sha256}`);
}

await build();
