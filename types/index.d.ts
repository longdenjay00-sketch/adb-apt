export interface AdbDevice {
  serial: string;
  status: string;
  model: string;
  device: string;
  product: string;
  transportId: string | null;
  isWireless: boolean;
}

export interface RepositorySource {
  id: string;
  type: 'fdroid' | 'github' | 'local';
  name: string;
  url?: string;
  repo?: string;
  path?: string;
  packageId?: string;
  alias?: string;
  section?: string;
  description?: string;
  enabled: boolean;
}

export interface CatalogPackage {
  packageId: string;
  alias?: string;
  name: string;
  versionName: string;
  versionCode?: number | null;
  section?: string;
  sourceId: string;
  repo?: string;
  abi?: string;
  license?: string;
  homepage?: string;
  downloadUrl?: string;
  description?: string;
}

export declare class ConfigManager {
  rootDir: string;
  cacheDir: string;
  apkCacheDir: string;
  backupDir: string;
  constructor(customRootDir?: string);
  ensureDirs(): Promise<void>;
  getSources(): Promise<RepositorySource[]>;
  saveSources(sources: RepositorySource[]): Promise<void>;
  addSource(source: Partial<RepositorySource> & { id: string }): Promise<RepositorySource[]>;
  removeSource(idOrUrl: string): Promise<{ removed: number; sources: RepositorySource[] }>;
  cleanApkCache(): Promise<{ deletedFiles: number; freedBytes: number }>;
}

export declare class AdbBridge {
  adbBin: string;
  serial: string | null;
  dryRun: boolean;
  constructor(options?: {
    adbBin?: string;
    serial?: string;
    dryRun?: boolean;
    execRunner?: (args: string[], opts?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  });
  listDevices(): Promise<AdbDevice[]>;
  pairWireless(hostPort: string, pairingCode?: string): Promise<{ hostPort: string; paired: boolean; output: string }>;
  connectWireless(hostPort: string): Promise<{ target: string; connected: boolean; output: string }>;
  disconnectWireless(hostPort?: string): Promise<{ disconnected: boolean; output: string }>;
  installApk(apkPath: string, options?: Record<string, unknown>): Promise<{ installed: boolean; serial: string; apkPath: string; dryRun: boolean; output: string }>;
  removePackage(packageId: string, options?: Record<string, unknown>): Promise<{ removed: boolean; purge: boolean; packageId: string; serial: string; dryRun: boolean; output: string }>;
}

export declare class ApkBuilder {
  buildCompanionApk(options?: {
    packageId?: string;
    appName?: string;
    versionName?: string;
    versionCode?: number;
    outFile?: string;
  }): Promise<{
    apkPath: string;
    packageId: string;
    appName: string;
    versionName: string;
    versionCode: number;
    sizeBytes: number;
    sha256: string;
    entries: string[];
  }>;
}

export declare class AdbAptPackageManager {
  config: ConfigManager;
  adb: AdbBridge;
  apkBuilder: ApkBuilder;
  constructor(options?: Record<string, unknown>);
  update(options?: Record<string, unknown>): Promise<{ updatedAt: string; totalPackages: number; sourcesChecked: Array<Record<string, string>> }>;
  search(query: string, options?: Record<string, unknown>): Promise<CatalogPackage[]>;
  show(idOrAlias: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  install(specs: string | string[], options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  remove(packageSpecs: string | string[], options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  upgrade(targetSpec?: string | null, options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  list(options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  clean(): Promise<{ deletedFiles: number; freedBytes: number }>;
  backup(packageSpec: string, options?: Record<string, unknown>): Promise<{ packageId: string; serial: string; files: string[]; dryRun: boolean }>;
  restore(apkPath: string, options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  buildApk(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  getFundingInfo(): {
    package: string;
    version: string;
    goalUsd: number;
    currency: string;
    url: string;
    docs: string;
    portfolio: string;
    milestones: Array<{ title: string; amountUsd: number }>;
    tiers: Array<{ amountUsd: number; name: string }>;
  };
}

export declare function runCli(argv?: string[], io?: Record<string, unknown>): Promise<number>;
export declare function getHelpText(): string;
