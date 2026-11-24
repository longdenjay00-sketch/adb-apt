import { ConfigManager } from './config.js';
import { AdbBridge } from './adb.js';
import { RepositoryManager } from './repository.js';
import { ApkBuilder } from './apk-builder.js';

export class AdbAptPackageManager {
  constructor(options = {}) {
    this.config = options.config || new ConfigManager(options.homeDir);
    this.adb =
      options.adb ||
      new AdbBridge({
        adbBin: options.adbBin,
        serial: options.serial,
        dryRun: options.dryRun,
        execRunner: options.execRunner
      });
    this.apkBuilder = options.apkBuilder || new ApkBuilder();
    this.repo =
      options.repo ||
      new RepositoryManager(this.config, {
        fetchFn: options.fetchFn,
        offline: options.offline,
        apkBuilder: this.apkBuilder
      });
  }

  /**
   * `apt update` — Syncs configured F-Droid, GitHub Release, and local APK sources.
   */
  async update(options = {}) {
    let abi = 'arm64-v8a';
    try {
      abi = await this.adb.getDeviceAbi(options.serial);
    } catch {
      // Default to arm64-v8a if no device connected during index refresh
    }
    return this.repo.updateIndex({ ...options, abi });
  }

  /**
   * `apt search <query>` — Searches available packages across configured repositories.
   */
  async search(query, options = {}) {
    return this.repo.search(query, options);
  }

  /**
   * `apt show <pkg>` — Displays detailed control metadata from repo index and/or connected device.
   */
  async show(idOrAlias, options = {}) {
    const repoPkg = await this.repo.findPackage(idOrAlias);
    let devicePkg = null;
    const targetId = repoPkg ? repoPkg.packageId : idOrAlias;
    try {
      devicePkg = await this.adb.getPackageDetails(targetId, options.serial);
    } catch {
      devicePkg = null;
    }

    if (!repoPkg && !devicePkg) {
      throw new Error(`E: No packages found matching ${idOrAlias}`);
    }

    return {
      packageId: targetId,
      name: repoPkg?.name || targetId,
      alias: repoPkg?.alias || null,
      versionName: devicePkg?.versionName || repoPkg?.versionName || 'unknown',
      candidateVersion: repoPkg?.versionName || null,
      installedVersion: devicePkg?.versionName || null,
      installed: Boolean(devicePkg),
      section: repoPkg?.section || 'android',
      abi: repoPkg?.abi || 'universal',
      sourceId: repoPkg?.sourceId || (devicePkg ? 'device-installed' : 'unknown'),
      homepage: repoPkg?.homepage || null,
      downloadUrl: repoPkg?.downloadUrl || null,
      codePath: devicePkg?.codePath || null,
      dataDir: devicePkg?.dataDir || null,
      installer: devicePkg?.installerPackageName || null,
      permissions: devicePkg?.permissions || [],
      description: repoPkg?.description || 'Installed Android package on device.'
    };
  }

  /**
   * `apt install <specs...>` — Resolves, downloads, verifies, and installs one or more APK packages via ADB.
   */
  async install(specs = [], options = {}) {
    const specList = Array.isArray(specs) ? specs : [specs];
    if (specList.length === 0) {
      throw new Error('E: Must specify at least one package, GitHub repo (gh:owner/repo), or .apk path to install.');
    }

    let abi = 'arm64-v8a';
    try {
      abi = await this.adb.getDeviceAbi(options.serial);
    } catch {
      // Fallback to arm64-v8a
    }

    const installedResults = [];
    for (const spec of specList) {
      const resolved = await this.repo.resolveSpec(spec, { abi });
      const acquired = await this.repo.acquireApk(resolved, {
        dryRun: this.adb.dryRun || options.dryRun,
        forceDownload: options.reinstall
      });

      const installRes = await this.adb.installApk(acquired.apkPath, {
        serial: options.serial,
        downgrade: options.downgrade,
        grantPermissions: options.grantPermissions ?? true,
        allowTest: options.allowTest
      });

      await this.config.recordInstall(resolved.packageId, {
        name: resolved.name,
        versionName: resolved.versionName,
        versionCode: resolved.versionCode || null,
        sourceId: resolved.sourceId,
        sha256: acquired.sha256,
        apkPath: acquired.apkPath
      });

      installedResults.push({
        spec,
        packageId: resolved.packageId,
        versionName: resolved.versionName,
        sourceId: resolved.sourceId,
        apkPath: acquired.apkPath,
        sha256: acquired.sha256,
        cached: acquired.cached,
        serial: installRes.serial,
        dryRun: installRes.dryRun
      });
    }

    return installedResults;
  }

  /**
   * `apt remove <pkgs...>` or `apt purge <pkgs...>` — Uninstalls packages from target Android device.
   */
  async remove(packageSpecs = [], options = {}) {
    const list = Array.isArray(packageSpecs) ? packageSpecs : [packageSpecs];
    if (list.length === 0) {
      throw new Error('E: Must specify at least one package to remove.');
    }

    const results = [];
    for (const spec of list) {
      const catalogEntry = await this.repo.findPackage(spec);
      const packageId = catalogEntry ? catalogEntry.packageId : spec;
      const res = await this.adb.removePackage(packageId, {
        serial: options.serial,
        purge: Boolean(options.purge),
        keepData: Boolean(options.keepData),
        user: options.user
      });
      await this.config.recordRemoval(packageId, Boolean(options.purge));
      results.push(res);
    }
    return results;
  }

  /**
   * `apt list [--installed | --upgradable | --all]`
   */
  async list(options = {}) {
    const index = await this.config.getIndexCache();
    const state = await this.config.getState();
    const catalogById = new Map(index.packages.map((p) => [p.packageId, p]));

    if (options.installed || options.upgradable) {
      const devicePkgs = await this.adb.listInstalledPackages({
        serial: options.serial,
        thirdPartyOnly: options.thirdPartyOnly,
        systemOnly: options.systemOnly
      });

      const merged = devicePkgs.map((d) => {
        const cat = catalogById.get(d.packageId);
        const recorded = state.installed[d.packageId];
        const installedCode = d.versionCode || recorded?.versionCode || null;
        const candidateCode = cat?.versionCode || null;
        const upgradable =
          Boolean(cat) &&
          ((candidateCode && installedCode && candidateCode > installedCode) ||
            (recorded?.versionName && cat.versionName && recorded.versionName !== cat.versionName));

        return {
          packageId: d.packageId,
          alias: cat?.alias || null,
          installedVersion: recorded?.versionName || (d.versionCode ? `vc${d.versionCode}` : 'installed'),
          candidateVersion: cat?.versionName || null,
          versionCode: d.versionCode,
          installer: d.installer,
          apkPath: d.apkPath,
          installed: true,
          upgradable
        };
      });

      if (options.upgradable) {
        return merged.filter((m) => m.upgradable);
      }
      return merged;
    }

    // Default: list catalog packages annotated with local state
    return index.packages.map((p) => ({
      packageId: p.packageId,
      alias: p.alias,
      name: p.name,
      versionName: p.versionName,
      section: p.section,
      sourceId: p.sourceId,
      abi: p.abi,
      installed: Boolean(state.installed[p.packageId])
    }));
  }

  /**
   * `apt upgrade [pkg]` — Upgrades all upgradable packages (or a specific package).
   */
  async upgrade(targetSpec = null, options = {}) {
    if (targetSpec) {
      return this.install([targetSpec], options);
    }

    const upgradable = await this.list({ ...options, upgradable: true });
    if (upgradable.length === 0) {
      return [];
    }
    const specs = upgradable.map((u) => u.packageId);
    return this.install(specs, options);
  }

  /**
   * `apt clean` — Clears downloaded `.apk` files from the local cache directory.
   */
  async clean() {
    return this.config.cleanApkCache();
  }

  /**
   * `adb-apt backup <pkg>` — Pulls installed APK(s) from the connected Android device to local disk.
   */
  async backup(packageSpec, options = {}) {
    const catalogEntry = await this.repo.findPackage(packageSpec);
    const packageId = catalogEntry ? catalogEntry.packageId : packageSpec;
    const outDir = options.outDir || this.config.backupDir;
    return this.adb.backupPackageApk(packageId, outDir, { serial: options.serial });
  }

  /**
   * `adb-apt restore <apkPath>` — Restores a previously backed-up `.apk` file onto the device.
   */
  async restore(apkPath, options = {}) {
    return this.install([apkPath], options);
  }

  /**
   * `adb-apt build-apk` — Generates a zipaligned installable Android `.apk` bundle.
   */
  async buildApk(options = {}) {
    return this.apkBuilder.buildCompanionApk(options);
  }

  /**
   * `adb-apt fund` — Returns open-source funding & $200 micro-grant goal metadata.
   */
  getFundingInfo() {
    return {
      package: 'adb-apt',
      version: '1.0.0',
      goalUsd: 200,
      currency: 'USD',
      url: 'https://github.com/sponsors/longdenjay00-sketch',
      docs: 'https://github.com/longdenjay00-sketch/adb-apt/blob/main/FUNDING.md',
      portfolio: 'https://longdenjay00-sketch.github.io/longdenjay00-sketch/',
      milestones: [
        { title: 'Hardware & Multi-ABI Test Bench', amountUsd: 75 },
        { title: 'Pure-JS APK Signature Scheme v2 Signer', amountUsd: 75 },
        { title: 'Automated F-Droid Delta Sync & CI Pipeline', amountUsd: 50 }
      ],
      tiers: [
        { amountUsd: 5, name: 'Terminal Backer' },
        { amountUsd: 25, name: 'Construct Operator' },
        { amountUsd: 50, name: 'Systems Patron' },
        { amountUsd: 200, name: 'Full Milestone Sponsor' }
      ]
    };
  }
}
