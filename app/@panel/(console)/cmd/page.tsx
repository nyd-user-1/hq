import Boundary from "@/app/ui/boundary";
import CopyText from "@/app/ui/copy-text";

export const dynamic = "force-dynamic";

// CMD = the CLI utility slash commands (the rest of the /help palette). Unlike
// skills, these control the live interactive session or open a TUI — clear,
// compact, model, theme, login, etc. — so they can't run via `claude -p` (a
// stateless one-shot has no live session or TUI to act on). The panel is a
// reference + click-to-copy: copy the command, paste into your real terminal.
const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "add-dir", desc: "Add a new working directory" },
  { cmd: "agents", desc: "Manage agent configurations" },
  { cmd: "background", desc: "Send this session to the background" },
  { cmd: "branch", desc: "Branch the conversation at this point" },
  { cmd: "btw", desc: "Ask a quick side question without interrupting" },
  { cmd: "cd", desc: "Move this session to a new working directory" },
  { cmd: "chrome", desc: "Open Claude in Chrome (beta) settings" },
  { cmd: "clear", desc: "Start a new session with empty context" },
  { cmd: "color", desc: "Set the prompt bar color for this session" },
  { cmd: "compact", desc: "Free up context by summarizing the conversation" },
  { cmd: "config", desc: "Open settings" },
  { cmd: "context", desc: "Visualize current context usage as a grid" },
  { cmd: "copy", desc: "Copy Claude's last response to clipboard" },
  { cmd: "debug", desc: "Enable debug logging for this session" },
  { cmd: "desktop", desc: "Continue this session in Claude Desktop" },
  { cmd: "diff", desc: "View uncommitted changes and per-turn diffs" },
  { cmd: "doctor", desc: "Diagnose and verify your Claude Code install" },
  { cmd: "effort", desc: "Set effort level for model usage" },
  { cmd: "exit", desc: "Exit the CLI" },
  { cmd: "export", desc: "Export the conversation to a file or clipboard" },
  { cmd: "fast", desc: "Toggle fast mode (Opus 4.8)" },
  { cmd: "feedback", desc: "Submit feedback or report a bug" },
  { cmd: "focus", desc: "Toggle focus view (prompt, summary, response)" },
  { cmd: "fork", desc: "Spawn a background agent inheriting the full conversation" },
  { cmd: "goal", desc: "Set a goal Claude checks before stopping" },
  { cmd: "help", desc: "Show help and available commands" },
  { cmd: "hooks", desc: "View hook configurations for tool events" },
  { cmd: "ide", desc: "Manage IDE integrations and show status" },
  { cmd: "insights", desc: "Generate a report analyzing your sessions" },
  { cmd: "install-github-app", desc: "Set up Claude GitHub Actions for a repo" },
  { cmd: "install-slack-app", desc: "Install the Claude Slack app" },
  { cmd: "keybindings", desc: "Open your keyboard shortcuts file" },
  { cmd: "login", desc: "Sign in with your Anthropic account" },
  { cmd: "logout", desc: "Sign out from your Anthropic account" },
  { cmd: "mcp", desc: "Manage MCP servers" },
  { cmd: "memory", desc: "Open a memory file in your editor" },
  { cmd: "mobile", desc: "Show QR code to download the Claude mobile app" },
  { cmd: "model", desc: "Set the AI model for Claude Code" },
  { cmd: "passes", desc: "Share a free week of Claude Code with friends" },
  { cmd: "permissions", desc: "Manage allow / deny tool permission rules" },
  { cmd: "plan", desc: "Enable plan mode or view the session plan" },
  { cmd: "plugin", desc: "Manage Claude Code plugins" },
  { cmd: "powerup", desc: "Discover Claude Code features via quick lessons" },
  { cmd: "privacy-settings", desc: "View and update your privacy settings" },
  { cmd: "radio", desc: "Listen to Claude FM lo-fi radio" },
  { cmd: "recap", desc: "Generate a one-line session recap now" },
  { cmd: "release-notes", desc: "View release notes" },
  { cmd: "reload-plugins", desc: "Activate pending plugin changes" },
  { cmd: "reload-skills", desc: "Pick up skills added / changed on disk" },
  { cmd: "remote-control", desc: "Control this session from your phone" },
  { cmd: "remote-env", desc: "Choose the default environment for cloud agents" },
  { cmd: "rename", desc: "Rename the current conversation" },
  { cmd: "resume", desc: "Resume a previous conversation" },
  { cmd: "rewind", desc: "Restore code / conversation to a previous point" },
  { cmd: "sandbox", desc: "Configure the sandbox" },
  { cmd: "skills", desc: "List available skills" },
  { cmd: "status", desc: "Show Claude Code status (version, model, account)" },
  { cmd: "stickers", desc: "Order Claude Code stickers" },
  { cmd: "tasks", desc: "View and manage background tasks" },
  { cmd: "teleport", desc: "Resume a Claude Code session from claude.ai" },
  { cmd: "terminal-setup", desc: "Enable the Option+Enter newline keybinding" },
  { cmd: "theme", desc: "Change the theme" },
  { cmd: "tui", desc: "Set the terminal UI renderer (default | fullscreen)" },
  { cmd: "upgrade", desc: "Upgrade to Max for higher rate limits" },
  { cmd: "usage", desc: "Show session cost, plan usage, and activity" },
  { cmd: "usage-credits", desc: "Configure usage credits for when you hit a limit" },
  { cmd: "voice", desc: "Toggle voice mode" },
  { cmd: "web-setup", desc: "Set up Claude Code on the web with GitHub" },
  { cmd: "workflows", desc: "Browse running and completed workflows" },
];

export default function Cmd() {
  return (
    <Boundary topOnly bleedX label="@panel/(console)/cmd/page.tsx">
      <p className="text-xs text-zinc-400">
        CLI utilities that control the live session or open a TUI — they can't run
        via <code className="font-mono text-zinc-300">claude -p</code>. Click to
        copy, then paste into your terminal. ({COMMANDS.length} commands)
      </p>
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
        {COMMANDS.map((c) => (
          <CopyText
            key={c.cmd}
            text={`/${c.cmd}`}
            className="flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-3 transition-colors hover:bg-zinc-800/30"
          >
            <span className="shrink-0 font-mono text-xs text-zinc-300">
              /{c.cmd}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {c.desc}
            </span>
          </CopyText>
        ))}
      </div>
    </Boundary>
  );
}
