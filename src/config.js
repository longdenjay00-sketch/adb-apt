import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const DEFAULT_SOURCES = [
  {
    id: 'fdroid-main',
    type: 'fdroid',
    name: 'F-Droid Official Repository',
    url: 'https://f-droid.org/repo',
    searchApi: 'https://search.f-droid.org/api/search_apps',
    enabled: true
  },
  {
    id: 'gh-termux-app',
    type: 'github',
    name: 'Termux Terminal Emulator',
    repo: 'termux/termux-app',
    packageId: 'com.termux',
    alias: 'termux',
    section: 'terminal',
    description: 'Termux Android terminal emulator and Linux environment app',
    enabled: true
  },
  {
    id: 'gh-termux-api',
    type: 'github',
    name: 'Termux:API Companion',
    repo: 'termux/termux-api',
    packageId: 'com.termux.api',
    alias: 'termux-api',
    section: 'terminal',
    description: 'Termux add-on app which exposes device functionality as API to command line programs',
    enabled: true
  },
  {
    id: 'gh-termux-x11',
    type: 'github',
    name: 'Termux:X11 Companion',
    repo: 'termux/termux-x11',
    packageId: 'com.termux.x11',
    alias: 'termux-x11',
    section: 'x11',
    description: 'Termux X11 add-on application for graphical Linux sessions on Android',
    enabled: true
  },
  {
    id: 'gh-newpipe',
    type: 'github',
    name: 'NewPipe Libre Streaming Client',
    repo: 'TeamNewPipe/NewPipe',
    packageId: 'org.schabi.newpipe',
    alias: 'newpipe',
    section: 'media',
    description: 'Lightweight libre streaming front-end for Android',
    enabled: true
  },
  {
    id: 'gh-localsend',
    type: 'github',
    name: 'LocalSend LAN File Transfer',
    repo: 'localsend/localsend',
    packageId: 'org.localsend.localsend_app',
    alias: 'localsend',
    section: 'network',
    description: 'Open-source cross-platform alternative to AirDrop over local network',
    enabled: true
  },
  {
    id: 'gh-shizuku',
    type: 'github',
    name: 'Shizuku System API Bridge',
    repo: 'RikkaApps/Shizuku',
    packageId: 'moe.shizuku.privileged.api',
    alias: 'shizuku',
    section: 'system',
    description: 'Use system APIs directly with ADB/root privileges from normal apps',
    enabled: true
  }
];

export const BUILTIN_CATALOG = [
  {
    packageId: 'com.termux',
    alias: 'termux',
    name: 'Termux',
    versionName: '0.118.1',
    versionCode: 118,
    section: 'terminal',
    sourceId: 'gh-termux-app',
    repo: 'termux/termux-app',
    abi: 'arm64-v8a',
    license: 'GPL-3.0',
    homepage: 'https://termux.dev',
    downloadUrl: 'https://f-droid.org/repo/com.termux_1000.apk',
    description: 'Android terminal emulator and Linux environment application that works directly with no rooting or setup required.'
  },
  {
    packageId: 'com.termux.api',
    alias: 'termux-api',
    name: 'Termux:API',
    versionName: '0.50.1',
    versionCode: 51,
    section: 'terminal',
    sourceId: 'gh-termux-api',
    repo: 'termux/termux-api',
    abi: 'universal',
    license: 'GPL-3.0',
    homepage: 'https://github.com/termux/termux-api',
    downloadUrl: 'https://f-droid.org/repo/com.termux.api_51.apk',
    description: 'Termux add-on app which exposes device hardware and Android APIs to CLI scripts.'
  },
  {
    packageId: 'org.fdroid.fdroid',
    alias: 'fdroid',
    name: 'F-Droid',
    versionName: '1.21.1',
    versionCode: 1021051,
    section: 'system',
    sourceId: 'fdroid-main',
    abi: 'universal',
    license: 'GPL-3.0',
    homepage: 'https://f-droid.org',
    downloadUrl: 'https://f-droid.org/F-Droid.apk',
    description: 'Installable catalogue of FOSS (Free and Open Source Software) applications for the Android platform.'
  },
  {
    packageId: 'org.schabi.newpipe',
    alias: 'newpipe',
    name: 'NewPipe',
    versionName: '0.27.2',
    versionCode: 998,
    section: 'media',
    sourceId: 'gh-newpipe',
    repo: 'TeamNewPipe/NewPipe',
    abi: 'universal',
    license: 'GPL-3.0',
    homepage: 'https://newpipe.net',
    downloadUrl: 'https://archive.newpipe.net/fdroid/repo/NewPipe_v0.27.2.apk',
    description: 'Lightweight libre streaming client for Android with background playback and downloads.'
  },
  {
    packageId: 'org.localsend.localsend_app',
    alias: 'localsend',
    name: 'LocalSend',
    versionName: '1.15.4',
    versionCode: 56,
    section: 'network',
    sourceId: 'gh-localsend',
    repo: 'localsend/localsend',
    abi: 'arm64-v8a',
    license: 'MIT',
    homepage: 'https://localsend.org',
    downloadUrl: 'https://github.com/localsend/localsend/releases/download/v1.15.4/LocalSend-1.15.4-android-arm64v8.apk',
    description: 'Share files to nearby devices over local Wi-Fi without an internet connection.'
  },
  {
    packageId: 'moe.shizuku.privileged.api',
    alias: 'shizuku',
    name: 'Shizuku',
    versionName: '13.5.4',
    versionCode: 1049,
    section: 'system',
    sourceId: 'gh-shizuku',
    repo: 'RikkaApps/Shizuku',
    abi: 'universal',
    license: 'Apache-2.0',
    homepage: 'https://shizuku.rikka.app',
    downloadUrl: 'https://github.com/RikkaApps/Shizuku/releases/download/v13.5.4/shizuku-v13.5.4.r1049.0e53409-release.apk',
    description: 'Let apps use system APIs directly with elevated ADB permissions.'
  },
  {
    packageId: 'com.adbapt.companion',
    alias: 'adb-apt-companion',
    name: 'ADB-APT Companion',
    versionName: '1.0.0',
    versionCode: 1,
    section: 'admin',
    sourceId: 'local-companion',
    abi: 'universal',
    license: 'MIT',
    homepage: 'https://github.com/longdenjay00-sketch/adb-apt',
    downloadUrl: 'local://companion',
    description: 'Built-in companion Android APK generated by adb-apt for on-device status and package verification.'
  }
];

export class ConfigManager {
  constructor(customRootDir = process.env.ADB_APT_HOME) {
    const home = os.homedir();
    this.rootDir = customRootDir || path.join(home, '.config', 'adb-apt');
    this.cacheDir = customRootDir
      ? path.join(customRootDir, 'cache')
      : path.join(home, '.cache', 'adb-apt');
    this.apkCacheDir = path.join(this.cacheDir, 'apks');
    this.backupDir = path.join(this.cacheDir, 'backups');
    this.sourcesPath = path.join(this.rootDir, 'sources.list.json');
    this.indexCachePath = path.join(this.cacheDir, 'index-cache.json');
    this.statePath = path.join(this.rootDir, 'installed-state.json');
  }

  async ensureDirs() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.apkCacheDir, { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });

    if (!existsSync(this.sourcesPath)) {
      await fs.writeFile(this.sourcesPath, JSON.stringify(DEFAULT_SOURCES, null, 2), 'utf8');
    }
    if (!existsSync(this.indexCachePath)) {
      await fs.writeFile(
        this.indexCachePath,
        JSON.stringify({ updatedAt: null, packages: BUILTIN_CATALOG }, null, 2),
        'utf8'
      );
    }
    if (!existsSync(this.statePath)) {
      await fs.writeFile(
        this.statePath,
        JSON.stringify({ installed: {}, history: [] }, null, 2),
        'utf8'
      );
    }
  }

  async getSources() {
    await this.ensureDirs();
    const raw = await fs.readFile(this.sourcesPath, 'utf8');
    return JSON.parse(raw);
  }

  async saveSources(sources) {
    await this.ensureDirs();
    await fs.writeFile(this.sourcesPath, JSON.stringify(sources, null, 2), 'utf8');
  }

  async addSource(source) {
    const sources = await this.getSources();
    const existingIdx = sources.findIndex((s) => s.id === source.id);
    if (existingIdx >= 0) {
      sources[existingIdx] = { ...sources[existingIdx], ...source };
    } else {
      sources.push({ enabled: true, ...source });
    }
    await this.saveSources(sources);
    return sources;
  }

  async removeSource(idOrUrl) {
    const sources = await this.getSources();
    const filtered = sources.filter((s) => s.id !== idOrUrl && s.url !== idOrUrl && s.repo !== idOrUrl);
    await this.saveSources(filtered);
    return { removed: sources.length - filtered.length, sources: filtered };
  }

  async getIndexCache() {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(this.indexCachePath, 'utf8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data.packages) || data.packages.length === 0) {
        return { updatedAt: data.updatedAt || null, packages: BUILTIN_CATALOG };
      }
      return data;
    } catch {
      return { updatedAt: null, packages: BUILTIN_CATALOG };
    }
  }

  async saveIndexCache(packages) {
    await this.ensureDirs();
    const payload = {
      updatedAt: new Date().toISOString(),
      packages
    };
    await fs.writeFile(this.indexCachePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  async getState() {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { installed: {}, history: [] };
    }
  }

  async recordInstall(packageId, metadata) {
    const state = await this.getState();
    state.installed[packageId] = {
      ...metadata,
      installedAt: new Date().toISOString()
    };
    state.history.push({
      action: 'install',
      packageId,
      versionName: metadata.versionName,
      timestamp: new Date().toISOString()
    });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async recordRemoval(packageId, purge = false) {
    const state = await this.getState();
    delete state.installed[packageId];
    state.history.push({
      action: purge ? 'purge' : 'remove',
      packageId,
      timestamp: new Date().toISOString()
    });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async cleanApkCache() {
    await this.ensureDirs();
    const entries = await fs.readdir(this.apkCacheDir, { withFileTypes: true });
    let freedBytes = 0;
    let deletedFiles = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(this.apkCacheDir, entry.name);
        const stat = await fs.stat(fullPath);
        freedBytes += stat.size;
        deletedFiles += 1;
        await fs.unlink(fullPath);
      }
    }
    return { deletedFiles, freedBytes };
  }
}
