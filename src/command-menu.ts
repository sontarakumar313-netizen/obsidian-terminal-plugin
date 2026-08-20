import { App, FuzzySuggestModal, type FuzzyMatch } from 'obsidian';

import type { WorkingDirectoryMode } from './settings';
import type { LaunchTarget } from './targets';

const getWorkingDirectoryLabel = (workingDirectory: WorkingDirectoryMode): string =>
  workingDirectory === 'current-note' ? 'Active note folder' : 'Vault folder';

const getCommandDetails = (target: LaunchTarget): string => {
  const command = target.toolCommand ?? 'Open terminal';
  return `(${getWorkingDirectoryLabel(target.workingDirectory)}) ${command}`;
};

export class TerminalCommandMenu extends FuzzySuggestModal<LaunchTarget> {
  constructor(
    app: App,
    private readonly targets: readonly LaunchTarget[],
    private readonly onChoose: (target: LaunchTarget) => void
  ) {
    super(app);
    this.setPlaceholder('Search commands…');
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to run' },
      { command: 'esc', purpose: 'to dismiss' }
    ]);
  }

  getItems(): LaunchTarget[] {
    return [...this.targets];
  }

  getItemText(target: LaunchTarget): string {
    return `${target.commandName} ${getCommandDetails(target)}`;
  }

  renderSuggestion(match: FuzzyMatch<LaunchTarget>, el: HTMLElement): void {
    const target = match.item;
    const details = getCommandDetails(target);

    el.addClass('terminal-commands-menu-item');
    el.createDiv({ cls: 'terminal-commands-menu-name', text: target.commandName });
    const detailsEl = el.createDiv({ cls: 'terminal-commands-menu-details', text: details });
    detailsEl.setAttr('title', details);
  }

  onChooseItem(target: LaunchTarget): void {
    this.onChoose(target);
  }
}
