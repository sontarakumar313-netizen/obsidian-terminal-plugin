import type { TerminalCommandsSettings, WorkingDirectoryMode } from './settings';

export type LaunchTarget = {
  id: string;
  commandName: string;
  toolCommand?: string;
  workingDirectory: WorkingDirectoryMode;
};

export const buildLaunchTargets = (
  settings: TerminalCommandsSettings
): readonly LaunchTarget[] => {
  const targets: LaunchTarget[] = [
    {
      id: 'open-terminal',
      commandName: 'Open in terminal',
      workingDirectory: 'vault'
    }
  ];

  for (const configuredCommand of settings.commands) {
    const name = configuredCommand.name.trim();
    const command = configuredCommand.command.trim();
    if (!name || !command) {
      continue;
    }
    targets.push({
      id: `open-${configuredCommand.id}`,
      commandName: name,
      toolCommand: command,
      workingDirectory: configuredCommand.workingDirectory
    });
  }

  return targets;
};
