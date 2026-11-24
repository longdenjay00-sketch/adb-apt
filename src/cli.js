import { parseArgs } from 'node:util';
import { AdbAptPackageManager } from './package-manager.js';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function fmt(color, text) {
  if (process.env.NO_COLOR) return String(text);
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

export function getHelpText() {
  return `${fmt('bold', 'adb-apt')} — APT-style Android APK Package Manager & Wireless ADB Bridge (v1.0.0)

${fmt('cyan', 'USAGE:')}
  adb-apt [options] <command> [arguments...]

${fmt('cyan', 'APT LIFECYCLE COMMANDS:')}
  update                         Refresh package indexes from F-Droid, GitHub & local sources
  install <pkg|gh:org/repo|apk>  Download, verify SHA-256, and install APK(s) onto Android device
  remove <pkg...>                Uninstall package(s) from device (use --keep-data to retain app data)
  purge <pkg...>                 Clear app data/cache (pm clear) and completely uninstall package(s)
  upgrade [pkg]                  Upgrade all upgradable packages (or a single specified package)
  search <query>                 Search indexed repositories and F-Droid for matching Android apps
  show <pkg>                     Display Debian APT-style control record and on-device package info
  list [--installed|--upgradable] List packages in catalog or installed on connected Android device
  clean                          Erase downloaded .apk archive files from local cache

${fmt('cyan', 'ADB BRIDGE & APK COMMANDS:')}
  devices                        List connected USB and Wireless ADB devices
  pair <ip:port> <code?>         Pair with an Android 11+ device over Wireless Debugging
  connect <ip[:port]>            Connect to an Android device over TCP/IP Wireless ADB
  disconnect [ip[:port]]         Disconnect wireless ADB endpoint(s)
  backup <pkg> [--out <dir>]     Pull installed .apk file(s) from device into local backup directory
  restore <file.apk>             Restore a backed-up .apk file onto the target Android device
  shell <cmd...>                 Execute an interactive or one-shot ADB shell command on device
  logcat [pkg] [--lines <n>]     Dump or filter device logcat (auto-resolves package PID)
  sources [list|add|remove]      Inspect or modify configured APK repositories (sources.list)
  build-apk [--out <file.apk>]   Build a zipaligned Android companion/wrapper APK package
  fund                           Display $200 micro-grant goal, milestones, and sponsorship links

${fmt('cyan', 'OPTIONS:')}
  -s, --serial <serial>          Target a specific ADB device serial or <ip:port>
  -y, --yes                      Automatic yes to prompts; run non-interactively
      --dry-run                  Simulate ADB and download operations without mutating device
      --offline                  Use cached repository metadata only (no network requests)
      --json                     Format output as machine-readable JSON
      --installed                Filter 'list' to packages installed on the device
      --upgradable               Filter 'list' to installed packages with newer repo versions
      --third-party              Filter device package list to 3rd-party user apps (-3)
      --keep-data                Retain app data and cache directories on 'remove' (-k)
      --downgrade                Allow version code downgrade during 'install' (-d)
      --user <id>                Target specific Android user ID (e.g. --user 0 for system debloat)
  -h, --help                     Show this help message
  -v, --version                  Display adb-apt version
`;
}

export async function runCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || ((msg) => process.stdout.write(`${msg}\n`));
  const stderr = io.stderr || ((msg) => process.stderr.write(`${msg}\n`));

  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      serial: { type: 'string', short: 's' },
      yes: { type: 'boolean', short: 'y', default: false },
      'dry-run': { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      installed: { type: 'boolean', default: false },
      upgradable: { type: 'boolean', default: false },
      'third-party': { type: 'boolean', default: false },
      'keep-data': { type: 'boolean', default: false },
      downgrade: { type: 'boolean', default: false },
      user: { type: 'string' },
      out: { type: 'string', short: 'o' },
      lines: { type: 'string', short: 'n' },
      'package-id': { type: 'string' },
      'app-name': { type: 'string' },
      'app-version': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false }
    }
  });

  const flags = parsed.values;
  const positionals = parsed.positionals;

  if (flags.version) {
    stdout('adb-apt 1.0.0');
    return 0;
  }

  const command = positionals[0];
  const args = positionals.slice(1);

  if (flags.help || !command || command === 'help') {
    stdout(getHelpText());
    return 0;
  }

  const pm = new AdbAptPackageManager({
    serial: flags.serial,
    dryRun: Boolean(flags['dry-run']),
    offline: Boolean(flags.offline),
    homeDir: io.homeDir
  });

  const printJsonOr = (data, formatter) => {
    if (flags.json) {
      stdout(JSON.stringify(data, null, 2));
    } else {
      formatter(data);
    }
  };

  try {
    switch (command) {
      case 'update': {
        const res = await pm.update({ serial: flags.serial, offline: flags.offline });
        printJsonOr(res, (d) => {
          d.sourcesChecked.forEach((s, idx) => {
            stdout(`${fmt('cyan', `${s.status}:${idx + 1}`)} ${s.url} [${s.sourceId}]`);
          });
          stdout(`Reading package lists... Done`);
          stdout(
            `${fmt('green', 'All indexes up to date.')} (${d.totalPackages} packages indexed at ${d.updatedAt})`
          );
        });
        return 0;
      }

      case 'search': {
        const query = args.join(' ');
        const matches = await pm.search(query, { offline: flags.offline });
        printJsonOr(matches, (list) => {
          stdout(`Sorting... Done`);
          stdout(`Full Text Search... Done`);
          if (list.length === 0) {
            stdout(`No packages found matching '${query}'.`);
            return;
          }
          for (const pkg of list) {
            const aliasTag = pkg.alias ? ` (${pkg.alias})` : '';
            stdout(
              `${fmt('green', pkg.packageId)}/${pkg.sourceId || 'catalog'} ${fmt('yellow', pkg.versionName || 'latest')} ${pkg.abi || 'universal'}${aliasTag}`
            );
            stdout(`  ${pkg.description || pkg.name}`);
            stdout('');
          }
        });
        return 0;
      }

      case 'show': {
        if (!args[0]) throw new Error('E: Must specify a package name for "show".');
        const info = await pm.show(args[0], { serial: flags.serial });
        printJsonOr(info, (p) => {
          const lines = [
            `Package: ${p.packageId}`,
            p.alias ? `Alias: ${p.alias}` : null,
            `Name: ${p.name}`,
            `Version: ${p.versionName}`,
            `Installed: ${p.installed ? 'yes' : 'no'}`,
            p.candidateVersion ? `Candidate: ${p.candidateVersion}` : null,
            `Section: ${p.section}`,
            `Architecture: ${p.abi}`,
            `APT-Sources: ${p.sourceId}`,
            p.homepage ? `Homepage: ${p.homepage}` : null,
            p.downloadUrl ? `Download-URL: ${p.downloadUrl}` : null,
            p.codePath ? `Device-Code-Path: ${p.codePath}` : null,
            p.dataDir ? `Device-Data-Dir: ${p.dataDir}` : null,
            p.installer ? `Installer: ${p.installer}` : null,
            p.permissions?.length ? `Permissions: ${p.permissions.slice(0, 6).join(', ')}` : null,
            `Description: ${p.description}`
          ].filter(Boolean);
          stdout(lines.join('\n'));
        });
        return 0;
      }

      case 'install': {
        const res = await pm.install(args, {
          serial: flags.serial,
          downgrade: Boolean(flags.downgrade),
          dryRun: Boolean(flags['dry-run'])
        });
        printJsonOr(res, (items) => {
          stdout(`Reading package lists... Done`);
          stdout(`Building dependency tree... Done`);
          for (const item of items) {
            stdout(
              `${fmt('cyan', 'Get:')} ${item.packageId} (${item.versionName}) [${item.cached ? 'cached' : 'downloaded'}]`
            );
            stdout(`  SHA256: ${fmt('dim', item.sha256)}`);
            stdout(
              `${fmt('green', 'Setting up')} ${item.packageId} (${item.versionName}) on ${item.serial} ...`
            );
          }
          stdout(fmt('green', `Successfully installed ${items.length} package(s).`));
        });
        return 0;
      }

      case 'remove':
      case 'uninstall':
      case 'purge': {
        const isPurge = command === 'purge';
        const res = await pm.remove(args, {
          serial: flags.serial,
          purge: isPurge,
          keepData: Boolean(flags['keep-data']),
          user: flags.user
        });
        printJsonOr(res, (items) => {
          stdout(`Reading package lists... Done`);
          for (const item of items) {
            const actionLabel = item.purge ? 'Purging configuration and data for' : 'Removing';
            stdout(`${fmt('yellow', actionLabel)} ${item.packageId} from ${item.serial} ...`);
          }
          stdout(fmt('green', `Successfully removed ${items.length} package(s).`));
        });
        return 0;
      }

      case 'upgrade': {
        const res = await pm.upgrade(args[0] || null, {
          serial: flags.serial,
          dryRun: Boolean(flags['dry-run'])
        });
        printJsonOr(res, (items) => {
          stdout(`Calculating upgrade... Done`);
          if (items.length === 0) {
            stdout(`0 upgraded, 0 newly installed, 0 to remove.`);
            return;
          }
          for (const item of items) {
            stdout(`${fmt('green', 'Upgraded')} ${item.packageId} -> ${item.versionName} (${item.serial})`);
          }
        });
        return 0;
      }

      case 'list': {
        const res = await pm.list({
          serial: flags.serial,
          installed: Boolean(flags.installed),
          upgradable: Boolean(flags.upgradable),
          thirdPartyOnly: Boolean(flags['third-party'])
        });
        printJsonOr(res, (items) => {
          stdout(`Listing... Done`);
          for (const item of items) {
            const statusBadge = item.installed ? fmt('green', '[installed]') : '';
            const ver = item.installedVersion || item.versionName || 'latest';
            const aliasStr = item.alias ? ` (${item.alias})` : '';
            stdout(`${fmt('bold', item.packageId)}${aliasStr} ${fmt('yellow', ver)} ${statusBadge}`);
          }
        });
        return 0;
      }

      case 'clean': {
        const res = await pm.clean();
        printJsonOr(res, (d) => {
          stdout(
            `${fmt('green', 'Cleaned local APK cache:')} removed ${d.deletedFiles} file(s) (${d.freedBytes} bytes freed).`
          );
        });
        return 0;
      }

      case 'devices': {
        const devices = await pm.adb.listDevices();
        printJsonOr(devices, (list) => {
          stdout(fmt('bold', 'List of ADB devices attached:'));
          if (list.length === 0) {
            stdout('  (no devices detected)');
            return;
          }
          for (const d of list) {
            const mode = d.isWireless ? 'wireless' : 'usb';
            stdout(
              `  ${fmt('green', d.serial)}\t${d.status}\tmodel:${d.model} device:${d.device} (${mode})`
            );
          }
        });
        return 0;
      }

      case 'pair': {
        const res = await pm.adb.pairWireless(args[0], args[1]);
        printJsonOr(res, (d) => {
          stdout(`${fmt('green', 'Paired')} with ${d.hostPort}: ${d.output}`);
        });
        return 0;
      }

      case 'connect': {
        const res = await pm.adb.connectWireless(args[0]);
        printJsonOr(res, (d) => {
          stdout(`${fmt('green', 'Connected')} to ${d.target}: ${d.output}`);
        });
        return 0;
      }

      case 'disconnect': {
        const res = await pm.adb.disconnectWireless(args[0]);
        printJsonOr(res, (d) => {
          stdout(`${fmt('yellow', 'Disconnected:')} ${d.output}`);
        });
        return 0;
      }

      case 'backup':
      case 'pull': {
        if (!args[0]) throw new Error('E: Must specify a package ID or alias to backup.');
        const res = await pm.backup(args[0], {
          serial: flags.serial,
          outDir: flags.out
        });
        printJsonOr(res, (d) => {
          stdout(
            `${fmt('green', 'Backed up')} ${d.packageId} from ${d.serial} -> ${d.files.join(', ')}`
          );
        });
        return 0;
      }

      case 'restore': {
        if (!args[0]) throw new Error('E: Must specify an .apk file path to restore.');
        const res = await pm.restore(args[0], { serial: flags.serial });
        printJsonOr(res, (items) => {
          stdout(`${fmt('green', 'Restored')} ${items[0].packageId} onto ${items[0].serial}`);
        });
        return 0;
      }

      case 'shell': {
        if (args.length === 0) {
          throw new Error('E: Must provide a shell command to execute (e.g., `adb-apt shell getprop ro.build.version.release`).');
        }
        const res = await pm.adb.runShell(args, { serial: flags.serial });
        printJsonOr(res, (d) => {
          if (d.stdout) stdout(d.stdout.trimEnd());
          if (d.stderr) stderr(d.stderr.trimEnd());
        });
        return res.exitCode;
      }

      case 'logcat': {
        const res = await pm.adb.dumpLogcat({
          serial: flags.serial,
          packageId: args[0] || null,
          lines: flags.lines ? Number.parseInt(flags.lines, 10) : 50
        });
        printJsonOr(res, (d) => {
          stdout(d.output.trimEnd());
        });
        return 0;
      }

      case 'sources': {
        const sub = args[0] || 'list';
        if (sub === 'list') {
          const sources = await pm.config.getSources();
          printJsonOr(sources, (list) => {
            for (const s of list) {
              const target = s.url || (s.repo ? `https://github.com/${s.repo}` : s.path);
              stdout(`${fmt('green', s.id)} [${s.type}] ${target}`);
            }
          });
          return 0;
        }
        if (sub === 'add') {
          const target = args[1];
          if (!target) throw new Error('E: Usage: adb-apt sources add <gh:owner/repo | https://url>');
          let newSource;
          if (target.startsWith('gh:') || target.startsWith('github:')) {
            const repo = target.replace(/^(?:gh|github):/, '');
            const alias = repo.split('/')[1]?.toLowerCase() || repo;
            newSource = {
              id: `gh-${alias}`,
              type: 'github',
              name: repo,
              repo,
              alias,
              enabled: true
            };
          } else {
            const slug = target.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24);
            newSource = {
              id: `custom-${slug}`,
              type: 'fdroid',
              name: target,
              url: target,
              enabled: true
            };
          }
          const updated = await pm.config.addSource(newSource);
          printJsonOr(updated, () => {
            stdout(`${fmt('green', 'Added repository source:')} ${newSource.id}`);
          });
          return 0;
        }
        if (sub === 'remove' || sub === 'rm') {
          if (!args[1]) throw new Error('E: Usage: adb-apt sources remove <source-id>');
          const res = await pm.config.removeSource(args[1]);
          printJsonOr(res, (d) => {
            stdout(`${fmt('yellow', 'Removed')} ${d.removed} source(s).`);
          });
          return 0;
        }
        throw new Error(`E: Unknown sources subcommand '${sub}'. Use list, add, or remove.`);
      }

      case 'build-apk': {
        const res = await pm.buildApk({
          outFile: flags.out,
          packageId: flags['package-id'],
          appName: flags['app-name'],
          versionName: flags['app-version']
        });
        printJsonOr(res, (d) => {
          stdout(
            `${fmt('green', 'Built zipaligned Android APK:')} ${d.apkPath} (${d.sizeBytes} bytes)`
          );
          stdout(`  Package: ${d.packageId} v${d.versionName} (code ${d.versionCode})`);
          stdout(`  SHA256:  ${d.sha256}`);
        });
        return 0;
      }

      case 'fund':
      case 'funding': {
        const info = pm.getFundingInfo();
        printJsonOr(info, (d) => {
          stdout(`${fmt('bold', 'adb-apt Open-Source Funding')} — Target Goal: ${fmt('green', `$${d.goalUsd} ${d.currency}`)}`);
          stdout(`  Sponsor URL: ${fmt('cyan', d.url)}`);
          stdout(`  Details:     ${d.docs}`);
          stdout('');
          stdout(fmt('bold', 'Milestones ($200 Goal):'));
          for (const m of d.milestones) {
            stdout(`  - ${fmt('yellow', `$${m.amountUsd}`)}: ${m.title}`);
          }
          stdout('');
          stdout(fmt('bold', 'Sponsorship Tiers:'));
          for (const t of d.tiers) {
            stdout(`  - ${fmt('green', `$${t.amountUsd}`)} — ${t.name}`);
          }
        });
        return 0;
      }

      default:
        throw new Error(`E: Invalid operation '${command}'. Run 'adb-apt --help' for usage.`);
    }
  } catch (err) {
    if (flags.json) {
      stdout(JSON.stringify({ error: err.message }, null, 2));
    } else {
      stderr(fmt('red', err.message));
    }
    return 1;
  }
}
