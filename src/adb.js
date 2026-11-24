import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Parses `adb devices -l` output into structured device records.
 */
export function parseAdbDevicesOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const devices = [];
  for (const line of lines) {
    if (line.startsWith('List of devices attached') || line.startsWith('* daemon')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, status, ...rest] = parts;
    const props = {};
    for (const token of rest) {
      const idx = token.indexOf(':');
      if (idx > 0) {
        props[token.slice(0, idx)] = token.slice(idx + 1);
      }
    }
    devices.push({
      serial,
      status,
      model: props.model || 'unknown',
      device: props.device || 'unknown',
      product: props.product || 'unknown',
      transportId: props.transport_id || null,
      isWireless: serial.includes(':')
    });
  }
  return devices;
}

/**
 * Parses `pm list packages -f -i --show-versioncode` output.
 */
export function parsePmListPackagesOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'));

  const packages = [];
  for (const line of lines) {
    // Format: package:/data/app/.../base.apk=com.termux  installer=com.android.vending versionCode:118
    // Or: package:com.termux
    const body = line.slice('package:'.length);
    const tokens = body.split(/\s+/);
    const firstToken = tokens[0] || '';
    let apkPath = null;
    let packageId = firstToken;

    const eqIdx = firstToken.lastIndexOf('=');
    if (eqIdx > 0 && firstToken.includes('/')) {
      apkPath = firstToken.slice(0, eqIdx);
      packageId = firstToken.slice(eqIdx + 1);
    }

    let installer = null;
    let versionCode = null;
    let uid = null;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('installer=')) {
        installer = t.slice('installer='.length);
      } else if (t.startsWith('versionCode:')) {
        versionCode = Number.parseInt(t.slice('versionCode:'.length), 10) || null;
      } else if (t.startsWith('uid:')) {
        uid = Number.parseInt(t.slice('uid:'.length), 10) || null;
      }
    }

    packages.push({
      packageId,
      apkPath,
      installer: installer === 'null' ? null : installer,
      versionCode,
      uid
    });
  }

  return packages.sort((a, b) => a.packageId.localeCompare(b.packageId));
}

/**
 * Parses `dumpsys package <pkg>` output into key metadata fields.
 */
export function parseDumpsysPackageOutput(packageId, stdout) {
  const text = String(stdout || '');
  const matchField = (regex) => {
    const m = text.match(regex);
    return m ? m[1].trim() : null;
  };

  const versionName = matchField(/versionName=([^\s\r\n]+)/);
  const versionCodeRaw = matchField(/versionCode=(\d+)/);
  const firstInstallTime = matchField(/firstInstallTime=([^\r\n]+)/);
  const lastUpdateTime = matchField(/lastUpdateTime=([^\r\n]+)/);
  const installerPackageName = matchField(/installerPackageName=([^\s\r\n]+)/);
  const codePath = matchField(/codePath=([^\s\r\n]+)/);
  const dataDir = matchField(/dataDir=([^\s\r\n]+)/);
  const targetSdk = matchField(/targetSdk=(\d+)/);
  const minSdk = matchField(/minSdk=(\d+)/);

  const requestedPermissions = [];
  const permSectionMatch = text.match(/requested permissions:\s*([\s\S]*?)(?:\n\s*[a-zA-Z ]+:|\n\n|$)/i);
  if (permSectionMatch) {
    const lines = permSectionMatch[1].split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('android.permission.') || trimmed.includes('.permission.')) {
        requestedPermissions.push(trimmed.split(':')[0].trim());
      }
    }
  }

  return {
    packageId,
    versionName: versionName || 'unknown',
    versionCode: versionCodeRaw ? Number.parseInt(versionCodeRaw, 10) : null,
    firstInstallTime,
    lastUpdateTime,
    installerPackageName,
    codePath,
    dataDir,
    targetSdk: targetSdk ? Number.parseInt(targetSdk, 10) : null,
    minSdk: minSdk ? Number.parseInt(minSdk, 10) : null,
    permissions: requestedPermissions.slice(0, 25)
  };
}

export class AdbBridge {
  constructor(options = {}) {
    this.adbBin = options.adbBin || process.env.ADB_BIN || 'adb';
    this.serial = options.serial || process.env.ANDROID_SERIAL || null;
    this.dryRun = Boolean(options.dryRun);
    this.execRunner = options.execRunner || this._defaultExec.bind(this);
  }

  async _defaultExec(args, execOpts = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(this.adbBin, args, {
        timeout: execOpts.timeout || 60000,
        maxBuffer: 16 * 1024 * 1024
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || '',
        exitCode: typeof err.code === 'number' ? err.code : 1
      };
    }
  }

  buildArgs(subArgs, serialOverride = null) {
    const targetSerial = serialOverride || this.serial;
    return targetSerial ? ['-s', targetSerial, ...subArgs] : [...subArgs];
  }

  async exec(subArgs, options = {}) {
    const fullArgs = options.noSerial
      ? [...subArgs]
      : this.buildArgs(subArgs, options.serial);

    if (this.dryRun && options.mutating) {
      return {
        stdout: `[DRY-RUN] ${this.adbBin} ${fullArgs.join(' ')}\nSuccess`,
        stderr: '',
        exitCode: 0,
        dryRun: true,
        command: `${this.adbBin} ${fullArgs.join(' ')}`
      };
    }
    return this.execRunner(fullArgs, options);
  }

  async listDevices() {
    if (this.dryRun) {
      return [
        {
          serial: this.serial || 'emulator-5554',
          status: 'device',
          model: 'DryRun_Android_Device',
          device: 'kaliproot_arm64',
          product: 'adb_apt_virtual',
          transportId: '1',
          isWireless: Boolean(this.serial && this.serial.includes(':'))
        }
      ];
    }
    const res = await this.exec(['devices', '-l'], { noSerial: true });
    return parseAdbDevicesOutput(res.stdout);
  }

  async resolveActiveSerial() {
    if (this.serial) return this.serial;
    const devices = await this.listDevices();
    const online = devices.filter((d) => d.status === 'device');
    if (online.length === 0) {
      if (this.dryRun) return 'emulator-5554';
      throw new Error(
        'No online ADB devices detected. Connect a device via USB, run `adb-apt connect <ip:port>`, or pass `--dry-run`.'
      );
    }
    return online[0].serial;
  }

  async pairWireless(hostPort, pairingCode) {
    if (!hostPort) throw new Error('Host:port is required for wireless ADB pairing.');
    const args = ['pair', hostPort];
    if (pairingCode) args.push(String(pairingCode));
    const res = await this.exec(args, { noSerial: true, mutating: true });
    if (res.exitCode !== 0) {
      throw new Error(`ADB wireless pairing failed: ${res.stderr || res.stdout}`);
    }
    return {
      hostPort,
      paired: true,
      output: (res.stdout || res.stderr).trim()
    };
  }

  async connectWireless(hostPort) {
    if (!hostPort) throw new Error('Host:port is required for wireless ADB connect.');
    const target = hostPort.includes(':') ? hostPort : `${hostPort}:5555`;
    const res = await this.exec(['connect', target], { noSerial: true, mutating: true });
    const out = (res.stdout || res.stderr).trim();
    const connected = res.exitCode === 0 && !out.toLowerCase().includes('failed') && !out.toLowerCase().includes('cannot');
    if (!connected && !this.dryRun) {
      throw new Error(`ADB connect failed: ${out}`);
    }
    return {
      target,
      connected: true,
      output: out
    };
  }

  async disconnectWireless(hostPort = null) {
    const args = hostPort ? ['disconnect', hostPort] : ['disconnect'];
    const res = await this.exec(args, { noSerial: true, mutating: true });
    return {
      disconnected: true,
      output: (res.stdout || res.stderr).trim()
    };
  }

  async getDeviceAbi(serialOverride = null) {
    if (this.dryRun) return 'arm64-v8a';
    const serial = serialOverride || (await this.resolveActiveSerial());
    const res = await this.exec(['shell', 'getprop', 'ro.product.cpu.abi'], { serial });
    const abi = res.stdout.trim();
    return abi || 'arm64-v8a';
  }

  async listInstalledPackages(options = {}) {
    if (this.dryRun) {
      return [
        {
          packageId: 'com.termux',
          apkPath: '/data/app/com.termux-1/base.apk',
          installer: 'org.fdroid.fdroid',
          versionCode: 117,
          uid: 10142
        },
        {
          packageId: 'org.fdroid.fdroid',
          apkPath: '/data/app/org.fdroid.fdroid-1/base.apk',
          installer: null,
          versionCode: 1021051,
          uid: 10143
        }
      ];
    }

    const serial = options.serial || (await this.resolveActiveSerial());
    const pmArgs = ['shell', 'pm', 'list', 'packages', '-f', '-i', '--show-versioncode'];
    if (options.thirdPartyOnly) pmArgs.push('-3');
    if (options.systemOnly) pmArgs.push('-s');

    let res = await this.exec(pmArgs, { serial });
    // Fallback for older Android versions that don't support --show-versioncode
    if (res.exitCode !== 0 || res.stderr.includes('Unknown option')) {
      const fallbackArgs = ['shell', 'pm', 'list', 'packages', '-f', '-i'];
      if (options.thirdPartyOnly) fallbackArgs.push('-3');
      if (options.systemOnly) fallbackArgs.push('-s');
      res = await this.exec(fallbackArgs, { serial });
    }
    if (res.exitCode !== 0) {
      throw new Error(`Failed to list installed packages: ${res.stderr || res.stdout}`);
    }
    return parsePmListPackagesOutput(res.stdout);
  }

  async getPackageDetails(packageId, serialOverride = null) {
    if (this.dryRun) {
      return {
        packageId,
        versionName: '1.0.0-dryrun',
        versionCode: 100,
        firstInstallTime: '2026-11-24 08:00:00',
        lastUpdateTime: '2026-11-24 08:00:00',
        installerPackageName: 'com.adbapt.cli',
        codePath: `/data/app/${packageId}-1`,
        dataDir: `/data/user/0/${packageId}`,
        targetSdk: 34,
        minSdk: 26,
        permissions: ['android.permission.INTERNET']
      };
    }

    const serial = serialOverride || (await this.resolveActiveSerial());
    const res = await this.exec(['shell', 'dumpsys', 'package', packageId], { serial });
    if (res.exitCode !== 0 || res.stdout.includes('Unable to find package')) {
      return null;
    }
    return parseDumpsysPackageOutput(packageId, res.stdout);
  }

  async installApk(apkPath, options = {}) {
    const serial = options.serial || (await this.resolveActiveSerial());
    const args = ['install', '-r'];
    if (options.downgrade) args.push('-d');
    if (options.grantPermissions) args.push('-g');
    if (options.allowTest) args.push('-t');
    args.push(apkPath);

    const res = await this.exec(args, { serial, mutating: true, timeout: 180000 });
    const out = `${res.stdout}\n${res.stderr}`.trim();
    if (res.exitCode !== 0 || (!out.includes('Success') && !res.dryRun)) {
      throw new Error(`ADB install failed for ${path.basename(apkPath)}: ${out}`);
    }
    return {
      installed: true,
      serial,
      apkPath,
      dryRun: Boolean(res.dryRun),
      output: out
    };
  }

  async removePackage(packageId, options = {}) {
    const serial = options.serial || (await this.resolveActiveSerial());
    const purge = Boolean(options.purge);
    const keepData = Boolean(options.keepData) && !purge;
    const userId = options.user ?? null;

    const steps = [];

    if (purge) {
      // Clear package data and cache before uninstalling (apt purge behavior)
      const clearRes = await this.exec(['shell', 'pm', 'clear', packageId], {
        serial,
        mutating: true
      });
      steps.push(`pm clear: ${(clearRes.stdout || clearRes.stderr).trim()}`);
    }

    let uninstallArgs;
    if (userId !== null) {
      uninstallArgs = ['shell', 'pm', 'uninstall', '--user', String(userId)];
      if (keepData) uninstallArgs.push('-k');
      uninstallArgs.push(packageId);
    } else if (keepData) {
      uninstallArgs = ['shell', 'cmd', 'package', 'uninstall', '-k', packageId];
    } else {
      uninstallArgs = ['uninstall', packageId];
    }

    let res = await this.exec(uninstallArgs, { serial, mutating: true });
    let out = `${res.stdout}\n${res.stderr}`.trim();

    // Automatic fallback to --user 0 for system apps that reject standard uninstall
    if (!this.dryRun && (res.exitCode !== 0 || out.includes('Failure')) && userId === null) {
      const sysFallback = await this.exec(
        ['shell', 'pm', 'uninstall', '--user', '0', packageId],
        { serial, mutating: true }
      );
      const sysOut = `${sysFallback.stdout}\n${sysFallback.stderr}`.trim();
      if (sysFallback.exitCode === 0 && sysOut.includes('Success')) {
        res = sysFallback;
        out = `${sysOut} (removed for user 0)`;
      }
    }

    if (res.exitCode !== 0 || (!out.includes('Success') && !res.dryRun)) {
      throw new Error(`Failed to remove ${packageId}: ${out}`);
    }

    steps.push(out);
    return {
      removed: true,
      purge,
      packageId,
      serial,
      dryRun: Boolean(res.dryRun),
      output: steps.join(' | ')
    };
  }

  async backupPackageApk(packageId, destDir, options = {}) {
    await fs.mkdir(destDir, { recursive: true });
    const serial = options.serial || (await this.resolveActiveSerial());

    if (this.dryRun) {
      const outPath = path.join(destDir, `${packageId}-backup.apk`);
      await fs.writeFile(outPath, 'PK\x03\x04DRY_RUN_BACKUP_APK', 'utf8');
      return {
        packageId,
        serial,
        files: [outPath],
        dryRun: true
      };
    }

    const pathRes = await this.exec(['shell', 'pm', 'path', packageId], { serial });
    const remotePaths = pathRes.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('package:'))
      .map((l) => l.slice('package:'.length).trim());

    if (remotePaths.length === 0) {
      throw new Error(`Package ${packageId} is not installed on device ${serial}`);
    }

    const pulledFiles = [];
    for (let i = 0; i < remotePaths.length; i++) {
      const remote = remotePaths[i];
      const suffix = remotePaths.length === 1 ? '.apk' : `-${path.basename(remote)}`;
      const localFile = path.join(destDir, `${packageId}${suffix}`);
      const pullRes = await this.exec(['pull', remote, localFile], { serial });
      if (pullRes.exitCode !== 0) {
        throw new Error(`Failed to pull ${remote}: ${pullRes.stderr || pullRes.stdout}`);
      }
      pulledFiles.push(localFile);
    }

    return {
      packageId,
      serial,
      files: pulledFiles,
      dryRun: false
    };
  }

  async runShell(commandArgs = [], options = {}) {
    const serial = options.serial || (await this.resolveActiveSerial());
    const cmdList = Array.isArray(commandArgs) ? commandArgs : [String(commandArgs)];
    const res = await this.exec(['shell', ...cmdList], {
      serial,
      mutating: Boolean(options.mutating)
    });
    return {
      serial,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr
    };
  }

  async dumpLogcat(options = {}) {
    const serial = options.serial || (await this.resolveActiveSerial());
    const lines = options.lines || 100;
    const args = ['logcat', '-d', '-t', String(lines)];

    if (options.packageId && !this.dryRun) {
      const pidRes = await this.exec(['shell', 'pidof', '-s', options.packageId], { serial });
      const pid = pidRes.stdout.trim();
      if (pid) {
        args.push(`--pid=${pid}`);
      }
    }

    if (options.tag) {
      args.push('-s', options.tag);
    }

    if (this.dryRun) {
      return {
        serial,
        output: `[DRY-RUN] 11-24 08:55:00.000  1234  1234 I ${options.packageId || 'ADB-APT'}: Logcat snapshot (${lines} lines)`
      };
    }

    const res = await this.exec(args, { serial });
    return {
      serial,
      output: res.stdout || res.stderr
    };
  }

  streamLogcatInteractive(options = {}) {
    const args = this.buildArgs(['logcat'], options.serial);
    if (options.tag) args.push('-s', options.tag);
    const child = spawn(this.adbBin, args, { stdio: 'inherit' });
    return child;
  }
}
