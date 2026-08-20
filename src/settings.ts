import { Platform } from 'obsidian';

type DesktopPlatform = 'win' | 'macos' | 'linux';

type TerminalAppByPlatform = {
  win?: string;
  macos?: string;
  linux?: string;
};

export type WorkingDirectoryMode = 'vault' | 'current-note';

export type CommandSettings = {
  id: string;
  name: string;
  command: string;
  workingDirectory: WorkingDirectoryMode;
};

export interface TerminalCommandsSettings {
  terminalApp: TerminalAppByPlatform;
  reuseExistingMacApp: boolean;
  commands: CommandSettings[];
  enableWslOnWindows: boolean;
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_COMMANDS: readonly CommandSettings[] = [
  {
    id: 'claude',
    name: 'Open in Claude Code',
    command: 'claude',
    workingDirectory: 'vault'
  },
  {
    id: 'codex',
    name: 'Open in Codex cli',
    command: 'codex',
    workingDirectory: 'vault'
  },
  {
    id: 'Antigravity',
    name: 'Open in Antigravity',
    command: 'agy --dangerously-skip-permissions',
    workingDirectory: 'vault'
  },
  {
    id: 'opencode',
    name: 'Open in OpenCode',
    command: 'opencode',
    workingDirectory: 'vault'
  },
  {
    id: 'git-pull',
    name: 'Git: pull',
    command: 'git pull',
    workingDirectory: 'vault'
  },
  {
    id: 'git-commit-push',
    name: 'Git: commit and push',
    command: 'git add . && git commit -m "Temp" && git push',
    workingDirectory: 'vault'
  }
];

export const defaultTerminalApp = (): string => {
  if (!Platform.isDesktopApp) {
    return '';
  }
  if (Platform.isMacOS) {
    return 'Terminal';
  }
  if (Platform.isWin) {
    return 'cmd.exe';
  }
  if (Platform.isLinux) {
    return 'x-terminal-emulator';
  }
  return '';
};

const getCurrentDesktopPlatform = (): DesktopPlatform | null => {
  if (!Platform.isDesktopApp) {
    return null;
  }
  if (Platform.isMacOS) {
    return 'macos';
  }
  if (Platform.isWin) {
    return 'win';
  }
  if (Platform.isLinux) {
    return 'linux';
  }
  return null;
};

const buildDefaultTerminalAppSetting = (): TerminalAppByPlatform => {
  const platform = getCurrentDesktopPlatform();
  const app = defaultTerminalApp();
  if (!platform) {
    return {};
  }
  return { [platform]: app };
};

const cloneDefaultCommands = (): CommandSettings[] =>
  DEFAULT_COMMANDS.map((command) => ({ ...command }));

export const DEFAULT_SETTINGS: TerminalCommandsSettings = {
  terminalApp: buildDefaultTerminalAppSetting(),
  reuseExistingMacApp: true,
  commands: cloneDefaultCommands(),
  enableWslOnWindows: false
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const normalizeTerminalAppSetting = (
  value: unknown,
  fallback: TerminalAppByPlatform
): TerminalAppByPlatform => {
  const platform = getCurrentDesktopPlatform();
  if (isRecord(value)) {
    const next: TerminalAppByPlatform = {};
    if (typeof value.win === 'string') {
      next.win = value.win.trim();
    }
    if (typeof value.macos === 'string') {
      next.macos = value.macos.trim();
    }
    if (typeof value.linux === 'string') {
      next.linux = value.linux.trim();
    }
    return next;
  }
  if (!platform) {
    return { ...fallback };
  }
  return { [platform]: fallback[platform] ?? '' };
};

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const normalizeWorkingDirectory = (value: unknown): WorkingDirectoryMode =>
  value === 'current-note' ? 'current-note' : 'vault';

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : null;
};

const createUniqueId = (usedIds: Set<string>): string => {
  let id: string;
  do {
    id = `command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (usedIds.has(id));
  return id;
};

const normalizeCommands = (value: unknown): CommandSettings[] => {
  if (!Array.isArray(value)) {
    return cloneDefaultCommands();
  }

  const usedIds = new Set<string>();
  const commands: CommandSettings[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    let id = normalizeId(item.id);
    if (!id || usedIds.has(id)) {
      id = createUniqueId(usedIds);
    }
    usedIds.add(id);

    commands.push({
      id,
      name: typeof item.name === 'string' ? item.name : '',
      command: typeof item.command === 'string' ? item.command : '',
      workingDirectory: normalizeWorkingDirectory(item.workingDirectory)
    });
  }
  return commands;
};

export const createCommand = (existing: readonly CommandSettings[]): CommandSettings => {
  const usedIds = new Set(existing.map((command) => command.id));
  return {
    id: createUniqueId(usedIds),
    name: '',
    command: '',
    workingDirectory: 'vault'
  };
};

export const normalizeSettings = (stored: unknown): TerminalCommandsSettings => {
  const source = isRecord(stored) ? stored : {};
  return {
    terminalApp: normalizeTerminalAppSetting(source.terminalApp, DEFAULT_SETTINGS.terminalApp),
    reuseExistingMacApp: readBoolean(
      source.reuseExistingMacApp,
      DEFAULT_SETTINGS.reuseExistingMacApp
    ),
    commands: normalizeCommands(source.commands),
    enableWslOnWindows: readBoolean(
      source.enableWslOnWindows,
      DEFAULT_SETTINGS.enableWslOnWindows
    )
  };
};

export const getCurrentTerminalApp = (terminalApp: TerminalAppByPlatform): string => {
  const platform = getCurrentDesktopPlatform();
  if (!platform) {
    return '';
  }
  return terminalApp[platform] ?? '';
};

export const setCurrentTerminalApp = (
  terminalApp: TerminalAppByPlatform,
  value: string
): TerminalAppByPlatform => {
  const platform = getCurrentDesktopPlatform();
  if (!platform) {
    return { ...terminalApp };
  }
  return {
    ...terminalApp,
    [platform]: value.trim()
  };
};
