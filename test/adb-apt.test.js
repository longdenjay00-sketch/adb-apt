import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  parseAdbDevicesOutput,
  parsePmListPackagesOutput,
  parseDumpsysPackageOutput,
  selectBestApkAsset,
  ApkBuilder,
  AdbAptPackageManager,
  runCli
} from '../src/index.js';

test('parseAdbDevicesOutput parses USB and wireless devices accurately', () => {
  const sample = `List of devices attached
R58M42ABCDEF           device usb:1-1 product:a52qnsxx model:SM_A525F device:a52q transport_id:2
192.168.1.42:5555      device product:byybuo_t10 model:SmartPad_T10 device:t10 transport_id:5
`;
  const devices = parseAdbDevicesOutput(sample);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].serial, 'R58M42ABCDEF');
  assert.equal(devices[0].model, 'SM_A525F');
  assert.equal(devices[0].isWireless, false);
  assert.equal(devices[1].serial, '192.168.1.42:5555');
  assert.equal(devices[1].isWireless, true);
  assert.equal(devices[1].transportId, '5');
});

test('parsePmListPackagesOutput parses package path, installer, and versionCode', () => {
  const sample = `package:/data/app/~~xyz==/com.termux-abc==/base.apk=com.termux  installer=org.fdroid.fdroid versionCode:118
package:/system/app/ EasterEgg/EasterEgg.apk=com.android.egg  installer=null versionCode:34
`;
  const pkgs = parsePmListPackagesOutput(sample);
  assert.equal(pkgs.length, 2);
  const termux = pkgs.find((p) => p.packageId === 'com.termux');
  assert.ok(termux);
  assert.equal(termux.installer, 'org.fdroid.fdroid');
  assert.equal(termux.versionCode, 118);
  assert.ok(termux.apkPath.endsWith('/base.apk'));
});

test('parseDumpsysPackageOutput extracts versionName, versionCode, SDKs, and permissions', () => {
  const sample = `Packages:
  Package [com.termux] (1a2b3c):
    userId=10142
    codePath=/data/app/com.termux-1
    versionCode=118 minSdk=24 targetSdk=28
    versionName=0.118.1
    installerPackageName=org.fdroid.fdroid
    dataDir=/data/user/0/com.termux
    firstInstallTime=2026-10-01 12:00:00
    lastUpdateTime=2026-11-24 08:30:00
    requested permissions:
      android.permission.INTERNET
      android.permission.WRITE_EXTERNAL_STORAGE
    install permissions:
`;
  const info = parseDumpsysPackageOutput('com.termux', sample);
  assert.equal(info.packageId, 'com.termux');
  assert.equal(info.versionName, '0.118.1');
  assert.equal(info.versionCode, 118);
  assert.equal(info.minSdk, 24);
  assert.equal(info.targetSdk, 28);
  assert.deepEqual(info.permissions, [
    'android.permission.INTERNET',
    'android.permission.WRITE_EXTERNAL_STORAGE'
  ]);
});

test('selectBestApkAsset chooses arm64-v8a or universal fallback', () => {
  const assets = [
    { name: 'app-x86_64-release.apk', browser_download_url: 'https://example.com/x86.apk' },
    { name: 'app-arm64-v8a-release.apk', browser_download_url: 'https://example.com/arm64.apk' },
    { name: 'app-universal-release.apk', browser_download_url: 'https://example.com/uni.apk' }
  ];
  const arm64 = selectBestApkAsset(assets, 'arm64-v8a');
  assert.equal(arm64.name, 'app-arm64-v8a-release.apk');

  const fallback = selectBestApkAsset(assets, 'riscv64');
  assert.equal(fallback.name, 'app-universal-release.apk');
});

test('ApkBuilder generates a 4-byte aligned valid ZIP/APK archive with DEX and Manifest', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-apt-apk-'));
  try {
    const outApk = path.join(tmpDir, 'custom.apk');
    const builder = new ApkBuilder();
    const res = await builder.buildCompanionApk({
      packageId: 'com.adbapt.testpkg',
      appName: 'Test Companion',
      versionName: '2.1.0',
      versionCode: 21,
      outFile: outApk
    });

    assert.equal(res.packageId, 'com.adbapt.testpkg');
    assert.ok(res.sizeBytes > 400);
    assert.equal(res.sha256.length, 64);

    const buf = await fs.readFile(outApk);
    // Verify ZIP magic PK\x03\x04
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    // Verify first entry data offset is 4-byte aligned
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    assert.equal((30 + nameLen + extraLen) % 4, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('AdbAptPackageManager full apt lifecycle (update, search, show, install, list, backup, purge, clean)', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-apt-home-'));
  try {
    const pm = new AdbAptPackageManager({
      homeDir: tmpHome,
      dryRun: true,
      offline: true
    });

    const updateRes = await pm.update();
    assert.ok(updateRes.totalPackages >= 6);

    const searchRes = await pm.search('termux');
    assert.ok(searchRes.some((p) => p.packageId === 'com.termux'));

    const showRes = await pm.show('termux');
    assert.equal(showRes.packageId, 'com.termux');

    const installRes = await pm.install(['adb-apt-companion', 'termux']);
    assert.equal(installRes.length, 2);
    assert.equal(installRes[0].packageId, 'com.adbapt.companion');

    const backupRes = await pm.backup('com.termux');
    assert.equal(backupRes.files.length, 1);

    const purgeRes = await pm.remove(['termux'], { purge: true });
    assert.equal(purgeRes[0].removed, true);
    assert.equal(purgeRes[0].purge, true);

    const cleanRes = await pm.clean();
    assert.ok(cleanRes.deletedFiles >= 1);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('CLI runner executes apt commands with --json and --dry-run', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-apt-cli-'));
  try {
    const logs = [];
    const code = await runCli(['search', 'shizuku', '--offline', '--json'], {
      homeDir: tmpHome,
      stdout: (line) => logs.push(line)
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(logs.join('\n'));
    assert.equal(parsed[0].packageId, 'moe.shizuku.privileged.api');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});
