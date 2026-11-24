# `adb-apt` — APT-Style Android APK Package Manager & Wireless ADB Toolkit

`adb-apt` (aliased as `apk-apt`) is a zero-dependency Node.js / npm CLI package manager and programmatic SDK that brings **Debian/Kali `apt` semantics** to **Android APK management over ADB**, complete with **F-Droid & GitHub Release repository resolution**, **wireless ADB pairing**, **APK backup/restore**, and an **aligned Android `.apk` companion builder**.

---

## Features

- **`apt`-Like Package Lifecycle**:
  - `adb-apt update` — Syncs configured F-Droid, GitHub Release, and local directory APK indexes.
  - `adb-apt install <pkg | gh:owner/repo | ./file.apk | https://...>` — Resolves target ABI (`arm64-v8a`, `armeabi-v7a`, `universal`), verifies SHA-256 digests, and installs via `adb install -r -g`.
  - `adb-apt remove <pkg>` — Uninstalls packages (supports `--keep-data` / `-k` and automatic `--user 0` fallback for system bloatware removal).
  - `adb-apt purge <pkg>` — Runs `pm clear <pkg>` to wipe app data/cache before uninstalling.
  - `adb-apt upgrade [pkg]` — Compares on-device `versionCode` against indexed repositories and upgrades outdated apps.
  - `adb-apt search <query>` — Searches local cached catalog and live F-Droid Search API.
  - `adb-apt show <pkg>` — Outputs Debian `apt show` control fields merged with live `adb shell dumpsys package` device telemetry.
  - `adb-apt list [--installed | --upgradable | --third-party]` — Lists repository or on-device packages.
  - `adb-apt clean` — Purges cached `.apk` files from `~/.cache/adb-apt/apks`.
- **Wireless & USB ADB Device Bridge**:
  - `adb-apt devices` — Lists attached USB and TCP/IP wireless devices.
  - `adb-apt pair <ip:port> <code>` & `adb-apt connect <ip:port>` — Android 11+ Wireless Debugging pairing & connection.
  - `adb-apt backup <pkg>` & `adb-apt restore <file.apk>` — Pulls installed base/split `.apk` files directly off the device and restores them on demand.
  - `adb-apt shell <cmd...>` & `adb-apt logcat [pkg]` — Runs shell commands or filters logcat automatically by resolving the target package's PID.
- **Built-in Android Companion `.apk` Packager**:
  - `adb-apt build-apk` — Generates a 4-byte `zipalign`-compliant Android `.apk` bundle (`dist/android/adb-apt-companion.apk`) with `AndroidManifest.xml`, Dalvik `classes.dex`, web assets, and `META-INF/MANIFEST.MF` SHA-256 digests in pure Node.js.

---

## Installation

```bash
# Install globally from npm or local tarball
npm install -g adb-apt

# Or run directly in development
node ./bin/adb-apt.js --help
```

---

## Quick Start

```bash
# 1. Refresh repository indexes (F-Droid + GitHub Releases)
adb-apt update

# 2. Search for packages
adb-apt search termux

# 3. Inspect package metadata
adb-apt show termux

# 4. Install by alias, package ID, GitHub repo, or local APK
adb-apt install termux
adb-apt install gh:localsend/localsend
adb-apt install ./dist/android/adb-apt-companion.apk

# 5. Pair & connect over Wireless ADB
adb-apt pair 192.168.1.42:37123 482910
adb-apt connect 192.168.1.42:5555

# 6. Backup an installed app's APK from the device
adb-apt backup com.termux --out ./backups

# 7. Remove or purge a package (or debloat system app for user 0)
adb-apt remove com.example.app --keep-data
adb-apt purge com.example.bloat --user 0

# 8. Build a zipaligned companion Android APK
adb-apt build-apk --package-id com.adbapt.companion --app-name "ADB-APT Companion"
```

> **Tip:** Pass `--dry-run` to simulate any command when no physical Android device is attached, or `--json` for scripting and automation pipelines.

---

## Programmatic SDK Usage

```js
import { AdbAptPackageManager, ApkBuilder } from 'adb-apt';

const pm = new AdbAptPackageManager({ dryRun: true });
await pm.update();
const results = await pm.search('shizuku');
await pm.install(['shizuku']);

const builder = new ApkBuilder();
const apk = await builder.buildCompanionApk({
  packageId: 'com.example.custom',
  appName: 'Custom APK',
  versionName: '1.0.0'
});
console.log('Generated APK:', apk.apkPath, apk.sha256);
```

---

## License

MIT © `longdenjay00-sketch`
