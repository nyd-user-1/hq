import type { LibraryCommand } from "@/lib/commands-library";

// MCP PROMPT-COMMANDS — connected MCP servers expose prompts that appear as slash
// commands in the `/mcp__<server>__<prompt>` format (see the Commands doc, "MCP
// prompts"). True discovery is per-session and runtime (negotiated at the MCP
// handshake), which a disk reader can't see — so this is a CURATED SAMPLE of 10
// high-value entries, drawn from the servers actually connected in this
// environment, so the Commands panel renders the source + format faithfully while
// we build live discovery (backlog C3-live).
//
// Each entry's `name` is the full slash target minus the leading "/", and
// `sourceLabel` is the server, so they group under their own source chip.

const SAMPLE: { server: string; prompt: string; desc: string }[] = [
  { server: "Figma", prompt: "get_design_context", desc: "Pull a Figma design into code (design-to-code)." },
  { server: "Figma", prompt: "use_figma", desc: "Create or edit a Figma design from code or intent." },
  { server: "Gmail", prompt: "search_threads", desc: "Search your Gmail threads by query." },
  { server: "Google_Drive", prompt: "search_files", desc: "Search files across your Google Drive." },
  { server: "Neon", prompt: "run_sql", desc: "Run a SQL query against a Neon database branch." },
  { server: "Supabase", prompt: "execute_sql", desc: "Execute SQL against your Supabase project." },
  { server: "Supabase", prompt: "list_tables", desc: "List the tables in your Supabase project." },
  { server: "Webflow", prompt: "ask_webflow_ai", desc: "Ask Webflow's AI about your site." },
  { server: "Hugging_Face", prompt: "paper_search", desc: "Search arXiv / Hugging Face papers." },
  { server: "Hugging_Face", prompt: "hub_repo_search", desc: "Search models and datasets on the Hugging Face Hub." },
];

export const MCP_PROMPT_COMMANDS: LibraryCommand[] = SAMPLE.map((s) => ({
  id: `mcp:${s.server}:${s.prompt}`,
  name: `mcp__${s.server}__${s.prompt}`,
  description: s.desc,
  tokens: 0,
  source: "mcp",
  sourceLabel: s.server,
}));
