'use strict';

var child_process = require('child_process');
var path = require('path');
var obsidian = require('obsidian');
var fs = require('fs');
var os = require('os');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const resolveCommandManager = (app) => {
    const maybeCommands = app.commands;
    if (maybeCommands &&
        typeof maybeCommands.findCommand === 'function' &&
        typeof maybeCommands.removeCommand === 'function') {
        return maybeCommands;
    }
    return null;
};

const logger = {
    enabled: false,
    setEnabled(value) {
        this.enabled = value;
    },
    log(...args) {
        if (this.enabled) {
            console.debug('[terminal-commands]', ...args);
        }
    }
};

const sanitizeTerminalApp = (value) => value.trim();
const escapeDoubleQuotes = (value) => value.replace(/"/g, '\\"');
const escapeForCmdQuotedString = (value) => value.replace(/"/g, '""');
const toWslPath = (windowsPath) => {
    const normalized = windowsPath.replace(/\\/g, '/');
    const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
    if (!match) {
        return null;
    }
    const drive = match[1].toLowerCase();
    const rest = match[2];
    return `/mnt/${drive}/${rest}`;
};
const getPlatformSummary = () => {
    if (obsidian.Platform.isDesktopApp) {
        if (obsidian.Platform.isMacOS) {
            return 'desktop-macos';
        }
        if (obsidian.Platform.isWin) {
            return 'desktop-windows';
        }
        if (obsidian.Platform.isLinux) {
            return 'desktop-linux';
        }
        return 'desktop-unknown';
    }
    if (obsidian.Platform.isMobileApp) {
        if (obsidian.Platform.isIosApp) {
            return 'mobile-ios';
        }
        if (obsidian.Platform.isAndroidApp) {
            return 'mobile-android';
        }
        return 'mobile-unknown';
    }
    return 'unknown';
};
const ensureTempScript = (content) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-commands-'));
    const filePath = path.join(dir, 'launch.command');
    logger.log('Creating temp script', { dir, filePath });
    fs.writeFileSync(filePath, content, { mode: 0o755 });
    const cleanup = () => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            logger.log('Cleaned temp script', dir);
        }
        catch (error) {
            console.warn('[terminal-commands] Failed to remove temp script', error);
        }
    };
    return { path: filePath, cleanup };
};
const buildMacLaunch = (terminalApp, vaultPath, toolCommand, options) => {
    const app = sanitizeTerminalApp(terminalApp);
    if (!app) {
        return null;
    }
    const openFlag = (options === null || options === void 0 ? void 0 : options.reuseExistingMacApp) === false ? '-na' : '-a';
    if (!toolCommand) {
        const escapedApp = escapeDoubleQuotes(app);
        const escapedPath = escapeDoubleQuotes(vaultPath);
        const command = `open ${openFlag} "${escapedApp}" "${escapedPath}"`;
        logger.log('macOS simple launch', { app, command, vaultPath });
        return { command, cwd: vaultPath };
    }
    const escapedVaultPath = escapeDoubleQuotes(vaultPath);
    const scriptLines = ['#!/bin/bash', `cd "${escapedVaultPath}"`];
    if (toolCommand) {
        scriptLines.push(toolCommand);
    }
    scriptLines.push('exec "$SHELL"');
    const { path, cleanup } = ensureTempScript(scriptLines.join('\n'));
    const command = `open ${openFlag} "${escapeDoubleQuotes(app)}" "${path}"`;
    logger.log('macOS script launch', { app, command, script: path, toolCommand });
    return { command, cwd: vaultPath, cleanup };
};
const buildWindowsLaunch = (terminalApp, vaultPath, toolCommand, useWslOnWindows) => {
    const app = sanitizeTerminalApp(terminalApp);
    if (!app) {
        return null;
    }
    const escapedVault = vaultPath.replace(/"/g, '"');
    const cdCommand = `cd /d "${escapedVault}"`;
    const tool = toolCommand ? ` && ${toolCommand}` : '';
    const lowerApp = app.toLowerCase();
    if (useWslOnWindows) {
        const wslVaultPath = toWslPath(vaultPath);
        if (!wslVaultPath) {
            logger.log('Windows WSL launch skipped due to unsupported path', { vaultPath });
            return null;
        }
        const wslPrefix = `wsl.exe --cd "${escapeForCmdQuotedString(wslVaultPath)}"`;
        const wslCommand = toolCommand ? `${wslPrefix} ${toolCommand}` : wslPrefix;
        if (lowerApp === 'cmd.exe' || lowerApp === 'cmd') {
            const command = `start "" cmd.exe /K "${wslCommand}"`;
            logger.log('Windows launch (cmd.exe + WSL)', { command, toolCommand, vaultPath, wslVaultPath });
            return { command, cwd: vaultPath };
        }
        if (lowerApp === 'powershell' || lowerApp === 'powershell.exe') {
            const psWslPath = wslVaultPath.replace(/'/g, "''");
            const psCommand = toolCommand
                ? `start "" powershell -NoExit -Command "wsl.exe --cd '${psWslPath}' ${toolCommand}"`
                : `start "" powershell -NoExit -Command "wsl.exe --cd '${psWslPath}'"`;
            logger.log('Windows launch (powershell + WSL)', {
                command: psCommand,
                toolCommand,
                vaultPath,
                wslVaultPath
            });
            return { command: psCommand, cwd: vaultPath };
        }
        if (lowerApp === 'wt.exe' || lowerApp === 'wt') {
            const command = toolCommand
                ? `start "" wt.exe new-tab wsl.exe --cd "${escapeForCmdQuotedString(wslVaultPath)}" ${toolCommand}`
                : `start "" wt.exe new-tab wsl.exe --cd "${escapeForCmdQuotedString(wslVaultPath)}"`;
            logger.log('Windows launch (wt + WSL)', { command, toolCommand, vaultPath, wslVaultPath });
            return { command, cwd: vaultPath };
        }
        const command = `start "" cmd.exe /K "${wslCommand}"`;
        logger.log('Windows launch (generic + WSL fallback)', {
            command,
            app,
            toolCommand,
            vaultPath,
            wslVaultPath
        });
        return { command, cwd: vaultPath };
    }
    if (lowerApp === 'cmd.exe' || lowerApp === 'cmd') {
        const command = toolCommand
            ? `start "" cmd.exe /K "${cdCommand}${tool}"`
            : `start "" cmd.exe /K "${cdCommand}"`;
        logger.log('Windows launch (cmd.exe)', { command, toolCommand, vaultPath });
        return { command, cwd: vaultPath };
    }
    if (lowerApp === 'powershell' || lowerApp === 'powershell.exe') {
        if (!toolCommand) {
            const command = `start "" powershell -NoExit -Command "Set-Location '${vaultPath.replace(/'/g, "''")}';"`;
            logger.log('Windows launch (powershell)', { command, toolCommand, vaultPath });
            return { command, cwd: vaultPath };
        }
        const command = `start "" powershell -NoExit -Command "Set-Location '${vaultPath.replace(/'/g, "''")}'; ${toolCommand}"`;
        logger.log('Windows launch (powershell tool)', { command, toolCommand, vaultPath });
        return { command, cwd: vaultPath };
    }
    if (lowerApp === 'wt.exe' || lowerApp === 'wt') {
        const command = toolCommand
            ? `start "" wt.exe new-tab cmd /K "${cdCommand}${tool}"`
            : `start "" wt.exe new-tab cmd /K "${cdCommand}"`;
        logger.log('Windows launch (wt)', { command, toolCommand, vaultPath });
        return { command, cwd: vaultPath };
    }
    if (!toolCommand) {
        const command = `start "" "${app}"`;
        logger.log('Windows launch (generic simple)', { command, vaultPath });
        return { command, cwd: vaultPath };
    }
    const command = `start "" cmd.exe /K "${cdCommand}${tool}"`;
    logger.log('Windows launch (generic tool fallback)', { command, app, toolCommand, vaultPath });
    return { command, cwd: vaultPath };
};
const buildUnixLaunch = (terminalApp, vaultPath, toolCommand) => {
    const app = sanitizeTerminalApp(terminalApp);
    if (!app) {
        return null;
    }
    if (!toolCommand) {
        const command = `${app}`;
        logger.log('Unix launch (simple)', { command, vaultPath });
        return { command, cwd: vaultPath };
    }
    const shellCommand = `cd \\\"$PWD\\\"; ${toolCommand}; exec \\\"$SHELL\\\"`;
    if (app.includes('gnome-terminal')) {
        const command = `${app} -- bash -lc "${shellCommand}"`;
        logger.log('Unix launch (gnome-terminal)', { command, toolCommand, vaultPath });
        return { command, cwd: vaultPath };
    }
    if (app.includes('konsole')) {
        const command = `${app} -e bash -lc "${shellCommand}"`;
        logger.log('Unix launch (konsole)', { command, toolCommand, vaultPath });
        return { command, cwd: vaultPath };
    }
    const command = `${app} -e bash -lc "${shellCommand}"`;
    logger.log('Unix launch (generic tool)', { command, toolCommand, vaultPath });
    return { command, cwd: vaultPath };
};
const buildLaunchCommand = (terminalApp, vaultPath, toolCommand, options) => {
    if (!obsidian.Platform.isDesktopApp) {
        return null;
    }
    if (obsidian.Platform.isMacOS) {
        return buildMacLaunch(terminalApp, vaultPath, toolCommand, options);
    }
    if (obsidian.Platform.isWin) {
        return buildWindowsLaunch(terminalApp, vaultPath, toolCommand, options === null || options === void 0 ? void 0 : options.useWslOnWindows);
    }
    return buildUnixLaunch(terminalApp, vaultPath, toolCommand);
};

const DEFAULT_COMMANDS = [
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
const defaultTerminalApp = () => {
    if (!obsidian.Platform.isDesktopApp) {
        return '';
    }
    if (obsidian.Platform.isMacOS) {
        return 'Terminal';
    }
    if (obsidian.Platform.isWin) {
        return 'cmd.exe';
    }
    if (obsidian.Platform.isLinux) {
        return 'x-terminal-emulator';
    }
    return '';
};
const getCurrentDesktopPlatform = () => {
    if (!obsidian.Platform.isDesktopApp) {
        return null;
    }
    if (obsidian.Platform.isMacOS) {
        return 'macos';
    }
    if (obsidian.Platform.isWin) {
        return 'win';
    }
    if (obsidian.Platform.isLinux) {
        return 'linux';
    }
    return null;
};
const buildDefaultTerminalAppSetting = () => {
    const platform = getCurrentDesktopPlatform();
    const app = defaultTerminalApp();
    if (!platform) {
        return {};
    }
    return { [platform]: app };
};
const cloneDefaultCommands = () => DEFAULT_COMMANDS.map((command) => (Object.assign({}, command)));
const DEFAULT_SETTINGS = {
    terminalApp: buildDefaultTerminalAppSetting(),
    reuseExistingMacApp: true,
    commands: cloneDefaultCommands(),
    enableWslOnWindows: false
};
const isRecord = (value) => typeof value === 'object' && value !== null;
const normalizeTerminalAppSetting = (value, fallback) => {
    var _a;
    const platform = getCurrentDesktopPlatform();
    if (isRecord(value)) {
        const next = {};
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
        return Object.assign({}, fallback);
    }
    return { [platform]: (_a = fallback[platform]) !== null && _a !== void 0 ? _a : '' };
};
const readBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const normalizeWorkingDirectory = (value) => value === 'current-note' ? 'current-note' : 'vault';
const normalizeId = (value) => {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : null;
};
const createUniqueId = (usedIds) => {
    let id;
    do {
        id = `command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    } while (usedIds.has(id));
    return id;
};
const normalizeCommands = (value) => {
    if (!Array.isArray(value)) {
        return cloneDefaultCommands();
    }
    const usedIds = new Set();
    const commands = [];
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
const createCommand = (existing) => {
    const usedIds = new Set(existing.map((command) => command.id));
    return {
        id: createUniqueId(usedIds),
        name: '',
        command: '',
        workingDirectory: 'vault'
    };
};
const normalizeSettings = (stored) => {
    const source = isRecord(stored) ? stored : {};
    return {
        terminalApp: normalizeTerminalAppSetting(source.terminalApp, DEFAULT_SETTINGS.terminalApp),
        reuseExistingMacApp: readBoolean(source.reuseExistingMacApp, DEFAULT_SETTINGS.reuseExistingMacApp),
        commands: normalizeCommands(source.commands),
        enableWslOnWindows: readBoolean(source.enableWslOnWindows, DEFAULT_SETTINGS.enableWslOnWindows)
    };
};
const getCurrentTerminalApp = (terminalApp) => {
    var _a;
    const platform = getCurrentDesktopPlatform();
    if (!platform) {
        return '';
    }
    return (_a = terminalApp[platform]) !== null && _a !== void 0 ? _a : '';
};
const setCurrentTerminalApp = (terminalApp, value) => {
    const platform = getCurrentDesktopPlatform();
    if (!platform) {
        return Object.assign({}, terminalApp);
    }
    return Object.assign(Object.assign({}, terminalApp), { [platform]: value.trim() });
};

const SAVE_DELAY_MS = 250;
class DeleteCommandModal extends obsidian.Modal {
    constructor(app, commandName, confirmDelete) {
        super(app);
        this.commandName = commandName;
        this.confirmDelete = confirmDelete;
    }
    onOpen() {
        this.setTitle('Delete command');
        this.contentEl.createEl('p', {
            text: `Delete "${this.commandName}"? This action cannot be undone.`
        });
        const actions = new obsidian.Setting(this.contentEl);
        actions.settingEl.addClass('terminal-commands-delete-actions');
        actions.addButton((button) => {
            button.setButtonText('Cancel').onClick(() => this.close());
            button.buttonEl.focus();
        });
        actions.addButton((button) => button
            .setButtonText('Delete')
            .setWarning()
            .onClick(() => {
            this.close();
            this.confirmDelete();
        }));
    }
    onClose() {
        this.contentEl.empty();
    }
}
class TerminalCommandsSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.draggedCommandId = null;
        this.dropIndicatorRow = null;
        this.dropTargetIndex = null;
        this.saveTimer = null;
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        this.displayGeneralSettings(containerEl);
        this.displayCommands(containerEl);
    }
    hide() {
        this.flushScheduledSave();
        this.clearDragState();
    }
    displayGeneralSettings(containerEl) {
        new obsidian.Setting(containerEl).setName('Terminal integration').setHeading();
        new obsidian.Setting(containerEl)
            .setName('Terminal application name')
            .setDesc('Enter the command line app to launch, such as the default shell or a custom executable path.')
            .addText((text) => text
            .setPlaceholder(defaultTerminalApp())
            .setValue(getCurrentTerminalApp(this.plugin.settings.terminalApp))
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.terminalApp = setCurrentTerminalApp(this.plugin.settings.terminalApp, value);
            yield this.plugin.saveSettings();
        })));
        if (obsidian.Platform.isMacOS) {
            new obsidian.Setting(containerEl)
                .setName('Reuse existing Terminal instance')
                .setDesc('Use macOS open -a to reuse the configured Terminal app. Turn this off to launch a new instance.')
                .addToggle((toggle) => toggle.setValue(this.plugin.settings.reuseExistingMacApp).onChange((value) => __awaiter(this, void 0, void 0, function* () {
                this.plugin.settings.reuseExistingMacApp = value;
                yield this.plugin.saveSettings();
            })));
        }
        if (obsidian.Platform.isWin) {
            new obsidian.Setting(containerEl)
                .setName('Use WSL for commands')
                .setDesc('Run commands inside WSL on Windows.')
                .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableWslOnWindows).onChange((value) => __awaiter(this, void 0, void 0, function* () {
                this.plugin.settings.enableWslOnWindows = value;
                yield this.plugin.saveSettings();
            })));
        }
    }
    displayCommands(containerEl) {
        new obsidian.Setting(containerEl)
            .setName('Commands')
            .setHeading()
            .addButton((button) => button
            .setButtonText('Add command')
            .setCta()
            .onClick(() => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.commands.push(createCommand(this.plugin.settings.commands));
            yield this.saveImmediately();
            this.display();
        })));
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
    displayColumnWidths(tableEl) {
        const colgroup = tableEl.createEl('colgroup');
        colgroup.createEl('col', { cls: 'terminal-commands-col-drag' });
        colgroup.createEl('col', { cls: 'terminal-commands-col-name' });
        colgroup.createEl('col', { cls: 'terminal-commands-col-command' });
        colgroup.createEl('col', { cls: 'terminal-commands-col-directory' });
        colgroup.createEl('col', { cls: 'terminal-commands-col-delete' });
    }
    createHeaderCell(row, text, label) {
        const cell = row.createEl('th', { text });
        cell.scope = 'col';
        if (label) {
            cell.setAttribute('aria-label', label);
        }
    }
    displayCommandRow(bodyEl, command, index) {
        const rowEl = bodyEl.createEl('tr', { cls: 'terminal-commands-command-row' });
        rowEl.dataset.commandId = command.id;
        const dragCell = rowEl.createEl('td', { cls: 'terminal-commands-icon-cell' });
        const dragHandle = this.createIconButton(dragCell, 'grip-vertical', `Drag ${command.name || `command ${index + 1}`}`, 'terminal-commands-drag-handle');
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
            command.workingDirectory = workingDirectorySelect.value;
            void this.saveImmediately();
        });
        const deleteCell = rowEl.createEl('td', { cls: 'terminal-commands-icon-cell' });
        const deleteButton = this.createIconButton(deleteCell, 'trash-2', `Delete ${command.name || `command ${index + 1}`}`, 'terminal-commands-delete-button');
        deleteButton.addEventListener('click', () => {
            const displayName = command.name.trim() || `command ${index + 1}`;
            new DeleteCommandModal(this.app, displayName, () => {
                this.plugin.settings.commands = this.plugin.settings.commands.filter((candidate) => candidate.id !== command.id);
                void this.saveImmediately().then(() => this.display());
            }).open();
        });
    }
    createIconButton(parent, icon, label, className) {
        const button = parent.createEl('button', {
            cls: `clickable-icon ${className}`,
            attr: { type: 'button', 'aria-label': label, title: label }
        });
        obsidian.setIcon(button, icon);
        return button;
    }
    addSelectOption(select, value, label) {
        const option = select.createEl('option', { text: label });
        option.value = value;
    }
    attachCommandDragEvents(rowEl, handle, commandId, index) {
        handle.addEventListener('dragstart', (event) => {
            var _a;
            this.draggedCommandId = commandId;
            (_a = event.dataTransfer) === null || _a === void 0 ? void 0 : _a.setData('text/plain', commandId);
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
    attachTableBodyDropEvents(bodyEl) {
        bodyEl.addEventListener('dragover', (event) => {
            if (!this.draggedCommandId) {
                return;
            }
            event.preventDefault();
            this.showDropIndicator(bodyEl, null, true, this.plugin.settings.commands.length);
        });
        bodyEl.addEventListener('drop', (event) => {
            var _a;
            if (!this.draggedCommandId) {
                return;
            }
            event.preventDefault();
            const targetIndex = (_a = this.dropTargetIndex) !== null && _a !== void 0 ? _a : this.plugin.settings.commands.length;
            this.moveCommand(this.draggedCommandId, targetIndex);
        });
    }
    showDropIndicator(bodyEl, referenceRow, after, targetIndex) {
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
    moveCommand(commandId, targetIndex) {
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
    moveCommandByOffset(commandId, offset) {
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
    finishReorder() {
        this.clearDragState();
        void this.saveImmediately().then(() => this.display());
    }
    clearDragState() {
        var _a;
        this.draggedCommandId = null;
        this.dropTargetIndex = null;
        (_a = this.dropIndicatorRow) === null || _a === void 0 ? void 0 : _a.remove();
        this.dropIndicatorRow = null;
        this.containerEl
            .querySelectorAll('.is-dragging')
            .forEach((element) => {
            element.classList.remove('is-dragging');
        });
    }
    scheduleSave() {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
        }
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.plugin.saveSettings();
        }, SAVE_DELAY_MS);
    }
    flushScheduledSave() {
        if (this.saveTimer === null) {
            return;
        }
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        void this.plugin.saveSettings();
    }
    saveImmediately() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.saveTimer !== null) {
                window.clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
            yield this.plugin.saveSettings();
        });
    }
}

const buildLaunchTargets = (settings) => {
    const targets = [
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

const TEMP_SCRIPT_CLEANUP_DELAY_MS = 30000;
class TerminalCommandsPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.registeredCommandIds = new Set();
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadSettings();
            this.addSettingTab(new TerminalCommandsSettingTab(this.app, this));
            this.refreshCommands();
        });
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
                    this.runLaunchCommand(() => this.composeLaunchCommand(target.toolCommand, target.workingDirectory), target.commandName);
                }
            });
            this.registeredCommandIds.add(`${this.manifest.id}:${target.id}`);
        }
    }
    composeLaunchCommand(toolCommand, workingDirectory = 'vault') {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof obsidian.FileSystemAdapter)) {
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
        return launchCommand ? Object.assign(Object.assign({}, launchCommand), { cwd: launchPath }) : null;
    }
    getLaunchPath(vaultPath, workingDirectory) {
        var _a;
        if (workingDirectory === 'vault') {
            return vaultPath;
        }
        const activeFile = this.app.workspace.getActiveFile();
        const folderPath = (_a = activeFile === null || activeFile === void 0 ? void 0 : activeFile.parent) === null || _a === void 0 ? void 0 : _a.path;
        return folderPath ? path.join(vaultPath, folderPath) : vaultPath;
    }
    runLaunchCommand(buildCommand, label) {
        const launchCommand = buildCommand();
        if (!launchCommand) {
            new obsidian.Notice(`Unable to run ${label}. Check the Terminal Commands settings for the terminal application name.`);
            return;
        }
        this.executeShellCommand(launchCommand, label);
    }
    executeShellCommand(launchCommand, label) {
        var _a;
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof obsidian.FileSystemAdapter)) {
            new obsidian.Notice('File system adapter not available. This plugin works only on desktop.');
            return;
        }
        const vaultPath = adapter.getBasePath();
        const workingDirectory = (_a = launchCommand.cwd) !== null && _a !== void 0 ? _a : vaultPath;
        try {
            logger.log('Spawning command', {
                label,
                command: launchCommand.command,
                vaultPath,
                workingDirectory
            });
            const child = child_process.spawn(launchCommand.command, {
                cwd: workingDirectory,
                shell: true,
                detached: true,
                stdio: 'ignore'
            });
            child.on('error', (error) => {
                console.error(`[terminal-commands] Failed to run '${launchCommand.command}':`, error);
                new obsidian.Notice(`Failed to run ${label}. Check the developer console for details.`);
            });
            child.unref();
            logger.log('Spawned command successfully', { label });
        }
        catch (error) {
            console.error(`[terminal-commands] Unexpected error for '${launchCommand.command}':`, error);
            new obsidian.Notice(`Failed to run ${label}. Check the developer console for details.`);
        }
        finally {
            if (launchCommand.cleanup) {
                const cleanup = launchCommand.cleanup;
                setTimeout(() => {
                    try {
                        cleanup();
                    }
                    catch (error) {
                        console.warn('[terminal-commands] Cleanup after command failed', error);
                    }
                }, TEMP_SCRIPT_CLEANUP_DELAY_MS);
            }
        }
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = normalizeSettings(yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
            this.refreshCommands();
        });
    }
}

module.exports = TerminalCommandsPlugin;
//# sourceMappingURL=main.js.map
