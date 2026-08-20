import { App, Modal, Platform, Plugin, PluginSettingTab, Setting, setIcon } from 'obsidian';

import {
  createCommand,
  defaultTerminalApp,
  getCurrentTerminalApp,
  setCurrentTerminalApp,
  type CommandSettings,
  type TerminalCommandsSettings,
  type WorkingDirectoryMode
} from './settings';

type SettingsHost = Plugin & {
  settings: TerminalCommandsSettings;
  saveSettings: () => Promise<void>;
};

const SAVE_DELAY_MS = 250;

class DeleteCommandModal extends Modal {
  constructor(
    app: App,
    private readonly commandName: string,
    private readonly confirmDelete: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Delete command');
    this.contentEl.createEl('p', {
      text: `Delete "${this.commandName}"? This action cannot be undone.`
    });

    const actions = new Setting(this.contentEl);
    actions.settingEl.addClass('terminal-commands-delete-actions');
    actions.addButton((button) => {
      button.setButtonText('Cancel').onClick(() => this.close());
      button.buttonEl.focus();
    });
    actions.addButton((button) =>
      button
        .setButtonText('Delete')
        .setWarning()
        .onClick(() => {
          this.close();
          this.confirmDelete();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TerminalCommandsSettingTab extends PluginSettingTab {
  plugin: SettingsHost;
  private draggedCommandId: string | null = null;
  private dropIndicatorRow: HTMLTableRowElement | null = null;
  private dropTargetIndex: number | null = null;
  private saveTimer: number | null = null;

  constructor(app: App, plugin: SettingsHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.displayGeneralSettings(containerEl);
    this.displayCommands(containerEl);
  }

  hide(): void {
    this.flushScheduledSave();
    this.clearDragState();
  }

  private displayGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Terminal integration').setHeading();

    new Setting(containerEl)
      .setName('Terminal application name')
      .setDesc(
        'Enter the command line app to launch, such as the default shell or a custom executable path.'
      )
      .addText((text) =>
        text
          .setPlaceholder(defaultTerminalApp())
          .setValue(getCurrentTerminalApp(this.plugin.settings.terminalApp))
          .onChange(async (value) => {
            this.plugin.settings.terminalApp = setCurrentTerminalApp(
              this.plugin.settings.terminalApp,
              value
            );
            await this.plugin.saveSettings();
          })
      );

    if (Platform.isMacOS) {
      new Setting(containerEl)
        .setName('Reuse existing Terminal instance')
        .setDesc(
          'Use macOS open -a to reuse the configured Terminal app. Turn this off to launch a new instance.'
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.reuseExistingMacApp).onChange(async (value) => {
            this.plugin.settings.reuseExistingMacApp = value;
            await this.plugin.saveSettings();
          })
        );
    }

    if (Platform.isWin) {
      new Setting(containerEl)
        .setName('Use WSL for commands')
        .setDesc('Run commands inside WSL on Windows.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableWslOnWindows).onChange(async (value) => {
            this.plugin.settings.enableWslOnWindows = value;
            await this.plugin.saveSettings();
          })
        );
    }
  }

  private displayCommands(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Commands')
      .setHeading()
      .addButton((button) =>
        button
          .setButtonText('Add command')
          .setCta()
          .onClick(async () => {
            this.plugin.settings.commands.push(createCommand(this.plugin.settings.commands));
            await this.saveImmediately();
            this.display();
          })
      );

    const scrollEl = containerEl.createDiv({ cls: 'terminal-commands-command-table-scroll' });
    const tableEl = scrollEl.createEl('table', { cls: 'terminal-commands-command-table' });
    this.displayColumnWidths(tableEl);

    const headerRow = tableEl.createEl('thead').createEl('tr');
    this.createHeaderCell(headerRow, '', 'Drag handle');
    this.createHeaderCell(headerRow, 'Name');
    this.createHeaderCell(headerRow, 'Command');
    this.createHeaderCell(headerRow, 'Working directory');
    this.createHeaderCell(headerRow, '', 'Delete command');

    const bodyEl = tableEl.createEl('tbody');
    this.attachTableBodyDropEvents(bodyEl);

    if (this.plugin.settings.commands.length === 0) {
      const emptyCell = bodyEl.createEl('tr').createEl('td', {
        cls: 'terminal-commands-empty-state',
        text: 'No commands. Add a command to create a command palette entry.'
      });
      emptyCell.colSpan = 5;
      return;
    }

    this.plugin.settings.commands.forEach((command, index) => {
      this.displayCommandRow(bodyEl, command, index);
    });
  }

  private displayColumnWidths(tableEl: HTMLTableElement): void {
    const colgroup = tableEl.createEl('colgroup');
    colgroup.createEl('col', { cls: 'terminal-commands-col-drag' });
    colgroup.createEl('col', { cls: 'terminal-commands-col-name' });
    colgroup.createEl('col', { cls: 'terminal-commands-col-command' });
    colgroup.createEl('col', { cls: 'terminal-commands-col-directory' });
    colgroup.createEl('col', { cls: 'terminal-commands-col-delete' });
  }

  private createHeaderCell(row: HTMLTableRowElement, text: string, label?: string): void {
    const cell = row.createEl('th', { text });
    cell.scope = 'col';
    if (label) {
      cell.setAttribute('aria-label', label);
    }
  }

  private displayCommandRow(
    bodyEl: HTMLTableSectionElement,
    command: CommandSettings,
    index: number
  ): void {
    const rowEl = bodyEl.createEl('tr', { cls: 'terminal-commands-command-row' });
    rowEl.dataset.commandId = command.id;

    const dragCell = rowEl.createEl('td', { cls: 'terminal-commands-icon-cell' });
    const dragHandle = this.createIconButton(
      dragCell,
      'grip-vertical',
      `Drag ${command.name || `command ${index + 1}`}`,
      'terminal-commands-drag-handle'
    );
    dragHandle.draggable = true;
    this.attachCommandDragEvents(rowEl, dragHandle, command.id, index);

    const nameCell = rowEl.createEl('td');
    const nameInput = nameCell.createEl('input', {
      attr: { type: 'text', 'aria-label': 'Command palette name', placeholder: 'Name' }
    });
    nameInput.value = command.name;
    nameInput.addEventListener('input', () => {
      command.name = nameInput.value;
      this.scheduleSave();
    });

    const commandCell = rowEl.createEl('td');
    const commandInput = commandCell.createEl('input', {
      attr: { type: 'text', 'aria-label': 'Shell command', placeholder: 'Command' }
    });
    commandInput.value = command.command;
    commandInput.addEventListener('input', () => {
      command.command = commandInput.value;
      this.scheduleSave();
    });

    const directoryCell = rowEl.createEl('td');
    const workingDirectorySelect = directoryCell.createEl('select', {
      attr: { 'aria-label': 'Working directory' }
    });
    this.addSelectOption(workingDirectorySelect, 'current-note', 'Current note folder');
    this.addSelectOption(workingDirectorySelect, 'vault', 'Vault root');
    workingDirectorySelect.value = command.workingDirectory;
    workingDirectorySelect.addEventListener('change', () => {
      command.workingDirectory = workingDirectorySelect.value as WorkingDirectoryMode;
      void this.saveImmediately();
    });

    const deleteCell = rowEl.createEl('td', { cls: 'terminal-commands-icon-cell' });
    const deleteButton = this.createIconButton(
      deleteCell,
      'trash-2',
      `Delete ${command.name || `command ${index + 1}`}`,
      'terminal-commands-delete-button'
    );
    deleteButton.addEventListener('click', () => {
      const displayName = command.name.trim() || `command ${index + 1}`;
      new DeleteCommandModal(this.app, displayName, () => {
        this.plugin.settings.commands = this.plugin.settings.commands.filter(
          (candidate) => candidate.id !== command.id
        );
        void this.saveImmediately().then(() => this.display());
      }).open();
    });
  }

  private createIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    className: string
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: `clickable-icon ${className}`,
      attr: { type: 'button', 'aria-label': label, title: label }
    });
    setIcon(button, icon);
    return button;
  }

  private addSelectOption(select: HTMLSelectElement, value: string, label: string): void {
    const option = select.createEl('option', { text: label });
    option.value = value;
  }

  private attachCommandDragEvents(
    rowEl: HTMLTableRowElement,
    handle: HTMLElement,
    commandId: string,
    index: number
  ): void {
    handle.addEventListener('dragstart', (event) => {
      this.draggedCommandId = commandId;
      event.dataTransfer?.setData('text/plain', commandId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      rowEl.addClass('is-dragging');
    });
    handle.addEventListener('dragend', () => {
      this.clearDragState();
    });
    handle.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
        return;
      }
      event.preventDefault();
      this.moveCommandByOffset(commandId, event.key === 'ArrowUp' ? -1 : 1);
    });

    rowEl.addEventListener('dragover', (event) => {
      if (!this.draggedCommandId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const after = event.clientY > rowEl.getBoundingClientRect().top + rowEl.offsetHeight / 2;
      const bodyEl = rowEl.parentElement;
      if (bodyEl instanceof HTMLTableSectionElement) {
        this.showDropIndicator(bodyEl, rowEl, after, index + (after ? 1 : 0));
      }
    });
    rowEl.addEventListener('drop', (event) => {
      if (!this.draggedCommandId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const sourceId = this.draggedCommandId;
      const targetIndex = this.dropTargetIndex;
      if (targetIndex !== null) {
        this.moveCommand(sourceId, targetIndex);
      }
    });
  }

  private attachTableBodyDropEvents(bodyEl: HTMLTableSectionElement): void {
    bodyEl.addEventListener('dragover', (event) => {
      if (!this.draggedCommandId) {
        return;
      }
      event.preventDefault();
      this.showDropIndicator(bodyEl, null, true, this.plugin.settings.commands.length);
    });
    bodyEl.addEventListener('drop', (event) => {
      if (!this.draggedCommandId) {
        return;
      }
      event.preventDefault();
      const targetIndex = this.dropTargetIndex ?? this.plugin.settings.commands.length;
      this.moveCommand(this.draggedCommandId, targetIndex);
    });
  }

  private showDropIndicator(
    bodyEl: HTMLTableSectionElement,
    referenceRow: HTMLTableRowElement | null,
    after: boolean,
    targetIndex: number
  ): void {
    if (!this.dropIndicatorRow) {
      const indicatorRow = document.createElement('tr');
      indicatorRow.addClass('terminal-commands-drop-indicator');
      indicatorRow.setAttribute('aria-hidden', 'true');

      indicatorRow.createEl('td', { cls: 'terminal-commands-drop-spacer' });
      const lineCell = indicatorRow.createEl('td', {
        cls: 'terminal-commands-drop-line-cell'
      });
      lineCell.colSpan = 4;
      lineCell.createDiv({ cls: 'terminal-commands-drop-line' });

      indicatorRow.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      indicatorRow.addEventListener('drop', (event) => {
        if (!this.draggedCommandId || this.dropTargetIndex === null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.moveCommand(this.draggedCommandId, this.dropTargetIndex);
      });
      this.dropIndicatorRow = indicatorRow;
    }

    this.dropTargetIndex = targetIndex;
    if (!referenceRow) {
      bodyEl.appendChild(this.dropIndicatorRow);
      return;
    }
    const insertionPoint = after ? referenceRow.nextSibling : referenceRow;
    bodyEl.insertBefore(this.dropIndicatorRow, insertionPoint);
  }

  private moveCommand(commandId: string, targetIndex: number): void {
    const commands = this.plugin.settings.commands;
    const sourceIndex = commands.findIndex((command) => command.id === commandId);
    if (sourceIndex < 0) {
      this.clearDragState();
      return;
    }

    const [moved] = commands.splice(sourceIndex, 1);
    let insertionIndex = targetIndex;
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    insertionIndex = Math.max(0, Math.min(insertionIndex, commands.length));
    commands.splice(insertionIndex, 0, moved);
    this.finishReorder();
  }

  private moveCommandByOffset(commandId: string, offset: number): void {
    const commands = this.plugin.settings.commands;
    const sourceIndex = commands.findIndex((command) => command.id === commandId);
    const targetIndex = sourceIndex + offset;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= commands.length) {
      return;
    }
    const [moved] = commands.splice(sourceIndex, 1);
    commands.splice(targetIndex, 0, moved);
    this.finishReorder();
  }

  private finishReorder(): void {
    this.clearDragState();
    void this.saveImmediately().then(() => this.display());
  }

  private clearDragState(): void {
    this.draggedCommandId = null;
    this.dropTargetIndex = null;
    this.dropIndicatorRow?.remove();
    this.dropIndicatorRow = null;
    this.containerEl
      .querySelectorAll('.is-dragging')
      .forEach((element) => {
        element.classList.remove('is-dragging');
      });
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveSettings();
    }, SAVE_DELAY_MS);
  }

  private flushScheduledSave(): void {
    if (this.saveTimer === null) {
      return;
    }
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.plugin.saveSettings();
  }

  private async saveImmediately(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.plugin.saveSettings();
  }
}
