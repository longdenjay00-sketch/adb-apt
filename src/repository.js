import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BUILTIN_CATALOG } from './config.js';

/**
 * Selects the best matching `.apk` asset from a GitHub Release assets array
 * for the target Android ABI.
 */
export function selectBestApkAsset(assets = [], preferredAbi = 'arm64-v8a') {
  const apkAssets = assets.filter(
    (a) => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk')
  );
  if (apkAssets.length === 0) return null;
  if (apkAssets.length === 1) return apkAssets[0];

  const abiAliases = {
    'arm64-v8a': ['arm64-v8a', 'arm64v8', 'arm64', 'aarch64'],
    'armeabi-v7a': ['armeabi-v7a', 'armv7a', 'armv7', 'arm'],
    x86_64: ['x86_64', 'x64', 'amd64'],
    x86: ['x86', 'i686']
  };
  const needles = abiAliases[preferredAbi] || [preferredAbi];

  // 1. Exact ABI match
  for (const needle of needles) {
    const match = apkAssets.find((a) => a.name.toLowerCase().includes(needle));
    if (match) return match;
  }

  // 2. Universal / fat APK match
  const universal =
    apkAssets.find(
      (a) =>
        a.name.toLowerCase().includes('universal') ||
        a.name.toLowerCase().includes('noarch') ||
        a.name.toLowerCase().includes('-all')
    ) || apkAssets.find((a) => a.name.toLowerCase().includes('release'));
  if (universal) return universal;

  return apkAssets[0];
}

/**
 * Computes SHA-256 hex digest of a local file.
 */
export async function computeFileSha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export class RepositoryManager {
  constructor(configManager, options = {}) {
    this.config = configManager;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.offline = Boolean(options.offline);
    this.apkBuilder = options.apkBuilder || null;
  }

  /**
   * Refreshes all enabled sources in `sources.list.json` (`apt update`).
   */
  async updateIndex(options = {}) {
    const sources = await this.config.getSources();
    const enabledSources = sources.filter((s) => s.enabled !== false);
    const catalogMap = new Map();

    // Seed with built-in catalog so offline & fast queries always succeed
    for (const item of BUILTIN_CATALOG) {
      catalogMap.set(item.packageId, { ...item });
    }

    const report = [];
    const offline = Boolean(options.offline ?? this.offline);

    for (const src of enabledSources) {
      if (offline || !this.fetchFn) {
        report.push({
          sourceId: src.id,
          type: src.type,
          status: 'Hit (cached)',
          url: src.url || `https://github.com/${src.repo}`
        });
        continue;
      }

      try {
        if (src.type === 'github' && src.repo) {
          const apiUrl = `https://api.github.com/repos/${src.repo}/releases/latest`;
          const res = await this.fetchFn(apiUrl, {
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'adb-apt/1.0.0'
            },
            signal: AbortSignal.timeout(8000)
          });

          if (res.ok) {
            const release = await res.json();
            const asset = selectBestApkAsset(release.assets || [], options.abi || 'arm64-v8a');
            if (asset) {
              const versionName = String(release.tag_name || '').replace(/^v/i, '') || 'latest';
              const pkgId = src.packageId || `github.${src.repo.replace('/', '.')}`;
              const existing = catalogMap.get(pkgId) || {};
              catalogMap.set(pkgId, {
                ...existing,
                packageId: pkgId,
                alias: src.alias || src.repo.split('/')[1].toLowerCase(),
                name: src.name || src.repo,
                versionName,
                versionCode: existing.versionCode || Date.now(),
                section: src.section || 'github',
                sourceId: src.id,
                repo: src.repo,
                abi: options.abi || 'arm64-v8a',
                downloadUrl: asset.browser_download_url,
                downloadSize: asset.size || null,
                publishedAt: release.published_at || null,
                homepage: `https://github.com/${src.repo}`,
                description: src.description || release.name || `GitHub release from ${src.repo}`
              });
              report.push({
                sourceId: src.id,
                type: 'github',
                status: `Get (${versionName})`,
                url: apiUrl
              });
              continue;
            }
          }
          report.push({
            sourceId: src.id,
            type: 'github',
            status: 'Hit (fallback catalog)',
            url: apiUrl
          });
        } else if (src.type === 'fdroid') {
          report.push({
            sourceId: src.id,
            type: 'fdroid',
            status: 'Hit',
            url: src.url
          });
        } else if (src.type === 'local' && src.path) {
          const files = existsSync(src.path) ? await fs.readdir(src.path) : [];
          for (const file of files) {
            if (file.endsWith('.apk')) {
              const base = path.basename(file, '.apk');
              catalogMap.set(`local.${base}`, {
                packageId: `local.${base}`,
                alias: base.toLowerCase(),
                name: base,
                versionName: '1.0.0-local',
                versionCode: 1,
                section: 'local',
                sourceId: src.id,
                abi: 'universal',
                downloadUrl: path.join(src.path, file),
                description: `Local APK package from ${src.path}`
              });
            }
          }
          report.push({
            sourceId: src.id,
            type: 'local',
            status: 'Hit',
            url: src.path
          });
        }
      } catch {
        report.push({
          sourceId: src.id,
          type: src.type,
          status: 'Ign (offline/cached)',
          url: src.url || `https://github.com/${src.repo}`
        });
      }
    }

    const packages = Array.from(catalogMap.values()).sort((a, b) =>
      a.packageId.localeCompare(b.packageId)
    );
    const saved = await this.config.saveIndexCache(packages);

    return {
      updatedAt: saved.updatedAt,
      totalPackages: packages.length,
      sourcesChecked: report
    };
  }

  /**
   * Searches cached index and (if online) live F-Droid search endpoint (`apt search`).
   */
  async search(query, options = {}) {
    const q = String(query || '').trim().toLowerCase();
    const index = await this.config.getIndexCache();
    const resultsMap = new Map();

    for (const pkg of index.packages) {
      const hay = `${pkg.packageId} ${pkg.alias || ''} ${pkg.name || ''} ${pkg.description || ''} ${pkg.section || ''}`.toLowerCase();
      if (!q || hay.includes(q)) {
        resultsMap.set(pkg.packageId, pkg);
      }
    }

    if (q && !this.offline && !options.offline && this.fetchFn) {
      try {
        const url = `https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}`;
        const res = await this.fetchFn(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'adb-apt/1.0.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          for (const app of (data.apps || []).slice(0, 15)) {
            const pkgMatch = String(app.url || '').match(/\/packages\/([^/]+)\/?$/);
            const packageId = pkgMatch ? pkgMatch[1] : null;
            if (packageId && !resultsMap.has(packageId)) {
              resultsMap.set(packageId, {
                packageId,
                alias: packageId.split('.').pop(),
                name: app.name || packageId,
                versionName: 'latest',
                versionCode: null,
                section: 'fdroid',
                sourceId: 'fdroid-main',
                abi: 'universal',
                homepage: app.url,
                downloadUrl: `https://f-droid.org/repo/${packageId}.apk`,
                description: app.summary || 'F-Droid FOSS package'
              });
            }
          }
        }
      } catch {
        // Ignore live network errors and return local index matches
      }
    }

    return Array.from(resultsMap.values());
  }

  /**
   * Finds a single package entry by packageId or alias (`apt show`).
   */
  async findPackage(idOrAlias) {
    const needle = String(idOrAlias || '').trim().toLowerCase();
    const index = await this.config.getIndexCache();
    return (
      index.packages.find(
        (p) =>
          p.packageId.toLowerCase() === needle ||
          (p.alias && p.alias.toLowerCase() === needle) ||
          (p.name && p.name.toLowerCase() === needle)
      ) || null
    );
  }

  /**
   * Resolves a package specification passed to `adb-apt install <spec>`:
   * - Local file (`./app.apk` or `/path/to/app.apk`)
   * - Direct HTTP(S) `.apk` URL
   * - GitHub repo shorthand (`gh:owner/repo` or `github:owner/repo`)
   * - Catalog packageId or alias (`termux`, `com.termux`, `adb-apt-companion`, etc.)
   */
  async resolveSpec(spec, options = {}) {
    const raw = String(spec || '').trim();
    if (!raw) throw new Error('Package specification is required.');

    // 1. Local .apk file on disk
    if (raw.endsWith('.apk') && existsSync(raw)) {
      const absPath = path.resolve(raw);
      const stat = await fs.stat(absPath);
      const baseName = path.basename(absPath, '.apk');
      return {
        packageId: baseName.includes('.') ? baseName : `local.${baseName}`,
        name: baseName,
        versionName: 'local',
        sourceId: 'local-file',
        localPath: absPath,
        downloadSize: stat.size,
        abi: 'universal',
        description: `Local APK file (${absPath})`
      };
    }

    // 2. Direct URL
    if (/^https?:\/\/.+/i.test(raw)) {
      const urlObj = new URL(raw);
      const baseName = path.basename(urlObj.pathname, '.apk') || 'remote-package';
      return {
        packageId: baseName,
        name: baseName,
        versionName: 'remote',
        sourceId: 'direct-url',
        downloadUrl: raw,
        abi: options.abi || 'universal',
        description: `Direct APK URL (${raw})`
      };
    }

    // 3. GitHub Release shorthand: gh:owner/repo or github:owner/repo
    const ghMatch = raw.match(/^(?:gh|github):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@(.+))?$/i);
    if (ghMatch) {
      const [, repo, tag] = ghMatch;
      const endpoint = tag
        ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
        : `https://api.github.com/repos/${repo}/releases/latest`;

      if (!this.offline && this.fetchFn) {
        const res = await this.fetchFn(endpoint, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'adb-apt/1.0.0'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) {
          throw new Error(`GitHub release lookup failed for ${repo} (HTTP ${res.status})`);
        }
        const release = await res.json();
        const asset = selectBestApkAsset(release.assets || [], options.abi || 'arm64-v8a');
        if (!asset) {
          throw new Error(`No .apk asset found in GitHub release ${repo} (${release.tag_name})`);
        }
        return {
          packageId: `github.${repo.replace('/', '.').toLowerCase()}`,
          alias: repo.split('/')[1].toLowerCase(),
          name: repo,
          versionName: String(release.tag_name || '').replace(/^v/i, '') || 'latest',
          sourceId: `github:${repo}`,
          repo,
          abi: options.abi || 'arm64-v8a',
          downloadUrl: asset.browser_download_url,
          downloadSize: asset.size || null,
          description: release.name || `GitHub Release APK from ${repo}`
        };
      }

      // Offline fallback if in catalog
      const byRepo = (await this.config.getIndexCache()).packages.find(
        (p) => p.repo && p.repo.toLowerCase() === repo.toLowerCase()
      );
      if (byRepo) return byRepo;
      throw new Error(`Cannot resolve ${raw} while offline.`);
    }

    // 4. Built-in / cached catalog lookup by packageId or alias
    const found = await this.findPackage(raw);
    if (found) return found;

    throw new Error(
      `E: Unable to locate package ${raw}. Run 'adb-apt update' or use 'gh:owner/repo' / './path/to/app.apk'.`
    );
  }

  /**
   * Downloads or materializes a resolved package specification into the local APK cache.
   */
  async acquireApk(resolvedPkg, options = {}) {
    await this.config.ensureDirs();

    if (resolvedPkg.localPath && existsSync(resolvedPkg.localPath)) {
      const sha256 = await computeFileSha256(resolvedPkg.localPath);
      return {
        apkPath: resolvedPkg.localPath,
        sha256,
        cached: true
      };
    }

    const safeFileName = `${resolvedPkg.packageId}_${resolvedPkg.versionName || 'latest'}.apk`.replace(
      /[^A-Za-z0-9._-]/g,
      '_'
    );
    const destPath = path.join(this.config.apkCacheDir, safeFileName);

    // Built-in companion APK generator support
    if (resolvedPkg.downloadUrl === 'local://companion' && this.apkBuilder) {
      const built = await this.apkBuilder.buildCompanionApk({ outFile: destPath });
      const sha256 = await computeFileSha256(built.apkPath);
      return {
        apkPath: built.apkPath,
        sha256,
        cached: false,
        generatedCompanion: true
      };
    }

    if (existsSync(destPath) && !options.forceDownload) {
      const sha256 = await computeFileSha256(destPath);
      return {
        apkPath: destPath,
        sha256,
        cached: true
      };
    }

    if (options.dryRun) {
      await fs.writeFile(destPath, `PK\x03\x04DRY_RUN_APK:${resolvedPkg.packageId}`, 'utf8');
      const sha256 = await computeFileSha256(destPath);
      return {
        apkPath: destPath,
        sha256,
        cached: false,
        dryRun: true
      };
    }

    if (!resolvedPkg.downloadUrl) {
      throw new Error(`No download URL available for package ${resolvedPkg.packageId}`);
    }

    if (existsSync(resolvedPkg.downloadUrl)) {
      await fs.copyFile(resolvedPkg.downloadUrl, destPath);
      const sha256 = await computeFileSha256(destPath);
      return { apkPath: destPath, sha256, cached: false };
    }

    const res = await this.fetchFn(resolvedPkg.downloadUrl, {
      headers: { 'User-Agent': 'adb-apt/1.0.0' },
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      throw new Error(`Failed to download ${resolvedPkg.downloadUrl} (HTTP ${res.status})`);
    }
    const arrayBuf = await res.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuf));
    const sha256 = await computeFileSha256(destPath);

    if (resolvedPkg.sha256 && resolvedPkg.sha256.toLowerCase() !== sha256.toLowerCase()) {
      await fs.unlink(destPath);
      throw new Error(
        `SHA-256 mismatch for ${resolvedPkg.packageId}: expected ${resolvedPkg.sha256}, got ${sha256}`
      );
    }

    return {
      apkPath: destPath,
      sha256,
      cached: false
    };
  }
}
