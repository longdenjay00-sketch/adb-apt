import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Computes standard CRC-32 checksum for ZIP local/central headers.
 */
export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates an uncompressed (STORED), 4-byte aligned ZIP / APK archive in pure Node.js
 * compatible with Android zipalign rules.
 */
export function createAlignedApkZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(dataBuf);

    // Compute padding in extra field so file data starts on a 4-byte boundary (zipalign 4)
    const headerFixedLen = 30 + nameBuf.length;
    const remainder = (offset + headerFixedLen) % 4;
    const padLen = remainder === 0 ? 0 : 4 - remainder;
    const extraBuf = Buffer.alloc(padLen, 0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // Flags
    localHeader.writeUInt16LE(0, 8); // Compression method: 0 = STORED
    localHeader.writeUInt16LE(0x4000, 10); // Mod time
    localHeader.writeUInt16LE(0x5778, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extraBuf.length, 28);

    const fileOffset = offset;
    localParts.push(localHeader, nameBuf, extraBuf, dataBuf);
    offset += localHeader.length + nameBuf.length + extraBuf.length + dataBuf.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0, 8); // Flags
    centralHeader.writeUInt16LE(0, 10); // Compression: STORED
    centralHeader.writeUInt16LE(0x4000, 12);
    centralHeader.writeUInt16LE(0x5778, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(fileOffset, 42); // Relative offset of local header

    centralParts.push(centralHeader, nameBuf);
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

/**
 * Generates a minimal valid Dalvik Executable (`classes.dex`) 112-byte header with Adler32 & SHA-1.
 */
export function createMinimalDexBuffer() {
  const buf = Buffer.alloc(112, 0);
  // Magic: "dex\n035\0"
  buf.write('dex\n035\0', 0, 'ascii');
  // file_size = 112 (offset 32)
  buf.writeUInt32LE(112, 32);
  // header_size = 112 (offset 36)
  buf.writeUInt32LE(112, 36);
  // endian_tag = 0x12345678 (offset 40)
  buf.writeUInt32LE(0x12345678, 40);

  // SHA-1 digest of bytes [32..112) stored at bytes [12..32)
  const sha1 = crypto.createHash('sha1').update(buf.subarray(32)).digest();
  sha1.copy(buf, 12);

  // Adler-32 checksum of bytes [12..112) stored at bytes [8..12)
  let a = 1;
  let b = 0;
  for (let i = 12; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  buf.writeUInt32LE(adler, 8);
  return buf;
}

export class ApkBuilder {
  /**
   * Builds a self-contained, 4-byte zipaligned Android `.apk` bundle (`adb-apt-companion.apk` or custom).
   */
  async buildCompanionApk(options = {}) {
    const packageId = options.packageId || 'com.adbapt.companion';
    const appName = options.appName || 'ADB-APT Companion';
    const versionName = options.versionName || '1.0.0';
    const versionCode = Number(options.versionCode || 1);
    const outFile =
      options.outFile || path.resolve(process.cwd(), 'dist', 'android', 'adb-apt-companion.apk');

    await fs.mkdir(path.dirname(outFile), { recursive: true });

    const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageId}"
    android:versionCode="${versionCode}"
    android:versionName="${versionName}">
    <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="${appName}"
        android:allowBackup="true">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${appName}</title>
  <style>
    body { background: #0a0e14; color: #00ff9c; font-family: monospace; padding: 24px; }
    .card { border: 1px solid #00ff9c; border-radius: 8px; padding: 16px; max-width: 540px; }
    h1 { margin-top: 0; font-size: 1.4rem; }
    code { color: #73d0ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${appName} v${versionName}</h1>
    <p>Package ID: <code>${packageId}</code></p>
    <p>Managed via <code>adb-apt</code> CLI package manager.</p>
  </div>
</body>
</html>
`;

    const dexBuf = createMinimalDexBuffer();
    const pkgMetaJson = JSON.stringify(
      {
        packageId,
        appName,
        versionName,
        versionCode,
        builtBy: 'adb-apt/1.0.0',
        builtAt: new Date().toISOString()
      },
      null,
      2
    );

    const files = [
      { name: 'AndroidManifest.xml', data: Buffer.from(manifestXml, 'utf8') },
      { name: 'classes.dex', data: dexBuf },
      { name: 'assets/index.html', data: Buffer.from(indexHtml, 'utf8') },
      { name: 'assets/adb-apt.json', data: Buffer.from(pkgMetaJson, 'utf8') }
    ];

    // Generate META-INF/MANIFEST.MF with SHA-256 digests of each entry
    const mfLines = [
      'Manifest-Version: 1.0',
      'Created-By: 1.0.0 (adb-apt Android Packager)',
      ''
    ];
    for (const f of files) {
      const digest = crypto.createHash('sha256').update(f.data).digest('base64');
      mfLines.push(`Name: ${f.name}`);
      mfLines.push(`SHA-256-Digest: ${digest}`);
      mfLines.push('');
    }
    const manifestMfBuf = Buffer.from(mfLines.join('\r\n'), 'utf8');
    const sfDigest = crypto.createHash('sha256').update(manifestMfBuf).digest('base64');
    const certSfBuf = Buffer.from(
      [
        'Signature-Version: 1.0',
        'Created-By: 1.0.0 (adb-apt Android Packager)',
        `SHA-256-Digest-Manifest: ${sfDigest}`,
        ''
      ].join('\r\n'),
      'utf8'
    );

    const allEntries = [
      ...files,
      { name: 'META-INF/MANIFEST.MF', data: manifestMfBuf },
      { name: 'META-INF/CERT.SF', data: certSfBuf }
    ];

    const apkZipBuf = createAlignedApkZipBuffer(allEntries);
    await fs.writeFile(outFile, apkZipBuf);
    const sha256 = crypto.createHash('sha256').update(apkZipBuf).digest('hex');

    return {
      apkPath: outFile,
      packageId,
      appName,
      versionName,
      versionCode,
      sizeBytes: apkZipBuf.length,
      sha256,
      entries: allEntries.map((e) => e.name)
    };
  }
}
