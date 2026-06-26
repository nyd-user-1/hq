// The Claude Code built-in slash-command registry, transcribed from the official
// reference (https://code.claude.com/docs/en/commands). These live compiled
// inside the `claude` binary — not as individual files — so this is the one place
// hq curates them. The docs mark each entry: a bundled **Skill** or **Workflow**
// (a prompt handed to Claude, also auto-invokable) vs a plain **command** (CLI
// behavior). We carry that split as `kind`, so the Skills panel shows the skills
// and the Commands panel shows the commands — every `/` entry gets exactly one
// home. A few entries the docs omit but a live `/help` shows (design-sync, hq,
// update-config, design-login) are appended and tagged from their `/help` label.

export type CliKind = "command" | "skill";

export type CliEntry = {
  name: string; // the slash command, without the leading "/"
  kind: CliKind; // "skill" = a bundled Skill/Workflow; "command" = CLI behavior
  args?: string; // argument hint, e.g. "<path>" or "[name]"
  desc: string;
};

export const CLI_REGISTRY: CliEntry[] = [
  { name: "add-dir", kind: "command", args: "<path>", desc: "Add a working directory for file access during the current session." },
  { name: "advisor", kind: "command", args: "[model|off]", desc: "Enable/disable the advisor — a second model consulted for guidance at key moments." },
  { name: "agents", kind: "command", desc: "Manage agent (subagent) configurations." },
  { name: "autofix-pr", kind: "command", args: "[prompt]", desc: "Spawn a web session that watches the branch's PR and pushes fixes on CI failures or review comments." },
  { name: "background", kind: "command", args: "[prompt]", desc: "Detach the session to run as a background agent and free this terminal. Alias: /bg." },
  { name: "batch", kind: "skill", args: "<instruction>", desc: "Decompose a large-scale change into 5–30 independent units and run each in its own worktree." },
  { name: "branch", kind: "command", args: "[name]", desc: "Branch the conversation at this point to try a different direction without losing the original." },
  { name: "btw", kind: "command", args: "<question>", desc: "Ask a quick side question without adding to the conversation." },
  { name: "cd", kind: "command", args: "<path>", desc: "Move this session to a new working directory, preserving the prompt cache." },
  { name: "chrome", kind: "command", desc: "Configure Claude in Chrome settings." },
  { name: "claude-api", kind: "skill", args: "[migrate|managed-agents-onboard]", desc: "Load Claude API / SDK reference for your language; can migrate existing API code to a newer model." },
  { name: "clear", kind: "command", args: "[name]", desc: "Start a new conversation with empty context. The previous one stays in /resume. Aliases: /reset, /new." },
  { name: "code-review", kind: "skill", args: "[level] [--fix] [--comment] [target]", desc: "Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups." },
  { name: "color", kind: "command", args: "[color|default]", desc: "Set the prompt bar color for the current session." },
  { name: "compact", kind: "command", args: "[instructions]", desc: "Free up context by summarizing the conversation so far." },
  { name: "config", kind: "command", args: "[key=value ...]", desc: "Open Settings, or set a key directly (e.g. /config theme=dark). Alias: /settings." },
  { name: "context", kind: "command", args: "[all]", desc: "Visualize current context usage as a colored grid with optimization suggestions." },
  { name: "copy", kind: "command", args: "[N]", desc: "Copy the last assistant response to the clipboard (/copy N for the Nth-latest)." },
  { name: "debug", kind: "skill", args: "[description]", desc: "Enable debug logging for the session and diagnose issues from the debug log." },
  { name: "deep-research", kind: "skill", args: "<question>", desc: "Workflow: fan out web searches, cross-check sources, and synthesize a cited report." },
  { name: "desktop", kind: "command", desc: "Continue the current session in the Claude Code Desktop app. Alias: /app." },
  { name: "diff", kind: "command", desc: "Open an interactive diff viewer for uncommitted changes and per-turn diffs." },
  { name: "doctor", kind: "command", desc: "Diagnose and verify your Claude Code installation and settings." },
  { name: "effort", kind: "command", args: "[level|auto]", desc: "Set the model effort level (low/medium/high/xhigh/max/ultracode)." },
  { name: "exit", kind: "command", desc: "Exit the CLI. In an attached background session, detaches and keeps it running. Alias: /quit." },
  { name: "export", kind: "command", args: "[filename]", desc: "Export the current conversation as plain text to a file or the clipboard." },
  { name: "fast", kind: "command", args: "[on|off]", desc: "Toggle fast mode on or off." },
  { name: "feedback", kind: "command", args: "[report]", desc: "Submit feedback, report a bug, or share your conversation. Aliases: /bug, /share." },
  { name: "fewer-permission-prompts", kind: "skill", desc: "Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to reduce permission prompts." },
  { name: "focus", kind: "command", desc: "Toggle the focus view: your last prompt, a one-line tool summary, and the final response." },
  { name: "fork", kind: "command", args: "<directive>", desc: "Spawn a forked subagent that inherits the full conversation and works in the background." },
  { name: "goal", kind: "command", args: "[condition|clear]", desc: "Set a goal Claude keeps working toward across turns until the condition is met." },
  { name: "heapdump", kind: "command", desc: "Write a JS heap snapshot + memory breakdown for diagnosing high memory usage." },
  { name: "help", kind: "command", desc: "Show help and available commands." },
  { name: "hooks", kind: "command", desc: "View hook configurations for tool events." },
  { name: "ide", kind: "command", desc: "Manage IDE integrations and show status." },
  { name: "init", kind: "command", desc: "Initialize the project with a CLAUDE.md guide." },
  { name: "insights", kind: "command", desc: "Generate a report analyzing your Claude Code sessions — project areas, patterns, friction." },
  { name: "install-github-app", kind: "command", desc: "Install the Claude GitHub App for a repository, optionally setting up Actions." },
  { name: "install-slack-app", kind: "command", desc: "Install the Claude Slack app via the OAuth flow." },
  { name: "keybindings", kind: "command", desc: "Open your keyboard shortcuts file." },
  { name: "login", kind: "command", desc: "Sign in to your Anthropic account." },
  { name: "logout", kind: "command", desc: "Sign out from your Anthropic account." },
  { name: "loop", kind: "skill", args: "[interval] [prompt]", desc: "Run a prompt repeatedly while the session stays open; omit the interval to self-pace. Alias: /proactive." },
  { name: "mcp", kind: "command", args: "[reconnect|enable|disable ...]", desc: "Manage MCP server connections and OAuth authentication." },
  { name: "memory", kind: "command", desc: "Edit CLAUDE.md memory files, toggle auto-memory, and view auto-memory entries." },
  { name: "mobile", kind: "command", desc: "Show a QR code to download the Claude mobile app. Aliases: /ios, /android." },
  { name: "model", kind: "command", args: "[model]", desc: "Switch the AI model and save it as your default for new sessions." },
  { name: "passes", kind: "command", desc: "Share a free week of Claude Code with friends (if your account is eligible)." },
  { name: "permissions", kind: "command", desc: "Manage allow / ask / deny rules for tool permissions. Alias: /allowed-tools." },
  { name: "plan", kind: "command", args: "[description]", desc: "Enter plan mode directly from the prompt." },
  { name: "plugin", kind: "command", args: "[subcommand]", desc: "Manage Claude Code plugins (list, install, enable, disable)." },
  { name: "powerup", kind: "command", desc: "Discover Claude Code features through quick interactive lessons." },
  { name: "privacy-settings", kind: "command", desc: "View and update your privacy settings (Pro/Max only)." },
  { name: "radio", kind: "command", desc: "Open Claude FM lo-fi radio in your browser." },
  { name: "recap", kind: "command", desc: "Generate a one-line summary of the current session on demand." },
  { name: "release-notes", kind: "command", desc: "View the changelog in an interactive version picker." },
  { name: "reload-plugins", kind: "command", args: "[--force]", desc: "Reload active plugins to apply pending changes without restarting." },
  { name: "reload-skills", kind: "command", desc: "Re-scan skill and command directories so on-disk changes become available mid-session." },
  { name: "remote-control", kind: "command", desc: "Make this session available for remote control from claude.ai. Alias: /rc." },
  { name: "remote-env", kind: "command", desc: "Choose the default environment for cloud agents." },
  { name: "rename", kind: "command", args: "[name]", desc: "Rename the current session; auto-generates a name from history if omitted." },
  { name: "resume", kind: "command", args: "[session]", desc: "Resume a conversation by ID or name, or open the session picker. Alias: /continue." },
  { name: "review", kind: "command", args: "[PR]", desc: "Review a GitHub pull request, using the same review engine as /code-review." },
  { name: "rewind", kind: "command", desc: "Rewind the conversation and/or code to a previous checkpoint. Aliases: /checkpoint, /undo." },
  { name: "run", kind: "skill", desc: "Launch and drive your project's app to see a change working in the running app, not just tests." },
  { name: "run-skill-generator", kind: "skill", desc: "Teach /run and /verify how to build, launch, and drive your project's app via a per-project skill." },
  { name: "sandbox", kind: "command", desc: "Toggle sandbox mode (supported platforms only)." },
  { name: "schedule", kind: "command", args: "[description]", desc: "Create, update, list, or run routines that execute on cloud infrastructure. Alias: /routines." },
  { name: "scroll-speed", kind: "command", desc: "Adjust mouse wheel scroll speed (fullscreen rendering only)." },
  { name: "security-review", kind: "command", desc: "Analyze pending branch changes for security vulnerabilities (injection, auth, data exposure)." },
  { name: "setup-bedrock", kind: "command", desc: "Configure Amazon Bedrock auth, region, and model pins (when CLAUDE_CODE_USE_BEDROCK=1)." },
  { name: "setup-vertex", kind: "command", desc: "Configure Google Vertex AI auth, project, region, and model pins (when CLAUDE_CODE_USE_VERTEX=1)." },
  { name: "simplify", kind: "skill", args: "[target]", desc: "Review the changed code for cleanup (reuse, simplification, efficiency, altitude) and apply fixes." },
  { name: "skills", kind: "command", desc: "List available skills. Press t to sort by token count; Space to hide a skill." },
  { name: "status", kind: "command", desc: "Open Settings (Status tab): version, model, account, and connectivity." },
  { name: "statusline", kind: "command", desc: "Configure Claude Code's status line — describe what you want or auto-configure." },
  { name: "stickers", kind: "command", desc: "Order Claude Code stickers." },
  { name: "stop", kind: "command", desc: "Stop the current background session (only while attached)." },
  { name: "tasks", kind: "command", desc: "View and manage everything running in the background. Also /bashes." },
  { name: "team-onboarding", kind: "command", desc: "Generate a team onboarding guide from your Claude Code usage history." },
  { name: "teleport", kind: "command", desc: "Pull a Claude Code on the web session into this terminal. Also /tp." },
  { name: "terminal-setup", kind: "command", desc: "Configure terminal keybindings for Shift+Enter and other shortcuts." },
  { name: "theme", kind: "command", desc: "Change the color theme (auto / light / dark / colorblind / ANSI / custom)." },
  { name: "tui", kind: "command", args: "[default|fullscreen]", desc: "Set the terminal UI renderer and relaunch into it with your conversation intact." },
  { name: "ultraplan", kind: "command", args: "<prompt>", desc: "Draft a plan in an ultraplan session, review it in the browser, then execute remotely or locally." },
  { name: "ultrareview", kind: "command", args: "[PR]", desc: "Run a deep multi-agent cloud review. Preferred form is now /code-review ultra." },
  { name: "upgrade", kind: "command", desc: "Open the upgrade page to switch to a higher plan tier." },
  { name: "usage", kind: "command", desc: "Show session cost, plan usage limits, and activity stats. Aliases: /cost, /stats." },
  { name: "usage-credits", kind: "command", desc: "Configure usage credits to keep working when you hit a limit. Previously /extra-usage." },
  { name: "verify", kind: "skill", desc: "Confirm a change works by building and running your app and observing the result." },
  { name: "voice", kind: "command", args: "[hold|tap|off]", desc: "Toggle voice dictation, or enable it in a specific mode." },
  { name: "web-setup", kind: "command", desc: "Connect your GitHub account to Claude Code on the web via your local gh CLI." },
  { name: "workflows", kind: "command", desc: "Open the workflow progress view to watch, pause, resume, or save runs." },
  // Live in a /help menu but not in the docs table — tagged from their /help label.
  { name: "design-login", kind: "command", desc: "Authorize design-system access for /design-sync with your claude.ai account." },
  { name: "design-sync", kind: "skill", desc: "Push a React design system to claude.ai/design via a converter." },
  { name: "hq", kind: "skill", desc: "Open the hq dashboard in your browser, pinned to this session." },
  { name: "update-config", kind: "skill", desc: "Configure the Claude Code harness via settings.json (hooks, permissions, env)." },
];

export const CLI_COMMANDS = CLI_REGISTRY.filter((e) => e.kind === "command");
export const CLI_SKILLS = CLI_REGISTRY.filter((e) => e.kind === "skill");
