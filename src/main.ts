import { spawn } from 'child_process';
import { join } from 'path';

import { FileSystemAdapter, Notice, Plugin } from 'obsidian';

import { resolveCommandManager } from './command-manager';
import { buildLaunchCommand, getPlatformSummary, type LaunchCommand } from './launcher';
import { logger } from './logger';
import {
  DEFAULT_SETTINGS,
  getCurrentTerminalApp,
  normalizeSettings,
  type TerminalCommandsSettings,
  type WorkingDirectoryMode
} from './settings';
import { TerminalCommandsSettingTab } from './settings-tab';
import { buildLaunchTargets } from './targets';

const TEMP_SCRIPT_CLEANUP_DELAY_MS = 30_000;

export default class TerminalCommandsPlugin extends Plugin {
  private registeredCommandIds = new Set<string>();
  settings: TerminalCommandsSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TerminalCommandsSettingTab(this.app, this));
    this.refreshCommands();
  }

  refreshCommands() {
    const commandManager = resolveCommandManager(this.app);

    if (commandManager) {
      for (const fullId of this.registeredCommandIds) {
        if (commandManager.findCommand(fullId)) {
          commandManager.removeCommand(fullId);
        }
      }
    }
    this.registeredCommandIds.clear();

    for (const target of buildLaunchTargets(this.settings)) {
      this.addCommand({
        id: target.id,
        name: target.commandName,
        callback: () => {
          this.runLaunchCommand(
            () => this.composeLaunchCommand(target.toolCommand, target.workingDirectory),
            target.commandName
          );
        }
      });
      this.registeredCommandIds.add(`${this.manifest.id}:${target.id}`);
    }
  }

  private composeLaunchCommand(
    toolCommand?: string,
    workingDirectory: WorkingDirectoryMode = 'vault'
  ): LaunchCommand | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    const vaultPath = adapter.getBasePath();
    const launchPath = this.getLaunchPath(vaultPath, workingDirectory);
    const terminalApp = getCurrentTerminalApp(this.settings.terminalApp);
    const launchCommand = buildLaunchCommand(terminalApp, launchPath, toolCommand, {
      useWslOnWindows: this.settings.enableWslOnWindows,
      reuseExistingMacApp: this.settings.reuseExistingMacApp
    });
    logger.log('Compose launch command', {
      platform: getPlatformSummary(),
      terminalApp,
      toolCommand,
      vaultPath,
      launchPath,
      launchCommand
    });
    return launchCommand ? { ...launchCommand, cwd: launchPath } : null;
  }

  private getLaunchPath(vaultPath: string, workingDirectory: WorkingDirectoryMode): string {
    if (workingDirectory === 'vault') {
      return vaultPath;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const folderPath = activeFile?.parent?.path;
    return folderPath ? join(vaultPath, folderPath) : vaultPath;
  }

  private runLaunchCommand(buildCommand: () => LaunchCommand | null, label: string) {
    const launchCommand = buildCommand();
    if (!launchCommand) {
      new Notice(
        `Unable to run ${label}. Check the Terminal Commands settings for the terminal application name.`
      );
      return;
    }
    this.executeShellCommand(launchCommand, label);
  }

  private executeShellCommand(launchCommand: LaunchCommand, label: string) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice('File system adapter not available. This plugin works only on desktop.');
      return;
    }

    const vaultPath = adapter.getBasePath();
    const workingDirectory = launchCommand.cwd ?? vaultPath;

    try {
      logger.log('Spawning command', {
        label,
        command: launchCommand.command,
        vaultPath,
        workingDirectory
      });
      const child = spawn(launchCommand.command, {
        cwd: workingDirectory,
        shell: true,
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', (error) => {
        console.error(`[terminal-commands] Failed to run '${launchCommand.command}':`, error);
        new Notice(`Failed to run ${label}. Check the developer console for details.`);
      });
      child.unref();
      logger.log('Spawned command successfully', { label });
    } catch (error) {
      console.error(`[terminal-commands] Unexpected error for '${launchCommand.command}':`, error);
      new Notice(`Failed to run ${label}. Check the developer console for details.`);
    } finally {
      if (launchCommand.cleanup) {
        const cleanup = launchCommand.cleanup;
        setTimeout(() => {
          try {
            cleanup();
          } catch (error) {
            console.warn('[terminal-commands] Cleanup after command failed', error);
          }
        }, TEMP_SCRIPT_CLEANUP_DELAY_MS);
      }
    }
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshCommands();
  }
}
