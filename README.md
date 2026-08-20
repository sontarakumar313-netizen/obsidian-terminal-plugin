# Terminal Commands

Terminal Commands is a desktop-only Obsidian plugin for opening a vault in a terminal and launching configurable shell commands from the command palette.

## Features

- Open the current vault in a configured terminal application.
- Manage commands in one compact five-column table.
- Edit each command's palette name, shell command, and working directory.
- Automatically register commands whose name and shell command are not empty.
- Reorder commands by dragging; a highlighted insertion line previews the destination.
- Delete commands through an Obsidian confirmation dialog.
- Start commands at the vault root or the active note's folder.
- Use platform-specific launch behavior on Windows, macOS, and Linux.
- Optionally launch commands through WSL on Windows.

## Initial commands

New installations include editable entries for:

- Claude Code
- Codex CLI
- Cursor CLI
- Gemini CLI
- OpenCode
- Git pull
- Git commit and push

These are ordinary commands. They can be edited, reordered, or deleted like commands added later.

## Settings

Open **Settings → Community plugins → Terminal Commands**.

The settings page contains:

- **Terminal application name** — terminal executable or application used for launches.
- **Reuse existing Terminal instance** — macOS-only option controlling `open -a` versus `open -na`.
- **Use WSL for commands** — Windows-only option for launching commands inside WSL.
- **Commands** — an ordered table containing:
  - Drag handle
  - Command palette name
  - Shell command
  - Working directory: `Current note folder` or `Vault root`
  - Delete button

`Current note folder` falls back to the vault root when no note is active. The always-available `Open in terminal` command opens the vault root.

## Security

Configured commands run through the system shell with the current user's permissions. Only add commands you understand and trust.

Git entries are ordinary shell commands and do not receive a separate repository pre-check.

## Platform behavior

- **macOS** — opens the configured terminal with `open`; command launches use a temporary executable `.command` script.
- **Windows** — supports `cmd.exe`, PowerShell, Windows Terminal, custom terminal executables, and optional WSL launches.
- **Linux / BSD** — launches the configured terminal directly or uses `bash -lc` when running a command.

## Development

```bash
npm install
npm run lint
npm run build
```

For local installation, copy these files into `.obsidian/plugins/terminal-commands/`:

- `manifest.json`
- `main.js`
- `styles.css`

Then reload Obsidian and enable **Terminal Commands** under Community plugins.

## Author

[sontara](https://github.com/sontarakumar313-netizen)

## Repository

[sontarakumar313-netizen/obsidian-terminal-plugin](https://github.com/sontarakumar313-netizen/obsidian-terminal-plugin)

## License

MIT
