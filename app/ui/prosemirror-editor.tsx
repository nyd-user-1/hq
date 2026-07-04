"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState, Plugin, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { type MarkType, type NodeType, type Attrs } from "prosemirror-model";
import {
  schema,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, setBlockType, toggleMark, chainCommands, exitCode, wrapIn } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules";
import {
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";

// The Docs surface's writing engine — ProseMirror (the same engine under
// Linear's editor), configured as a WYSIWYG *markdown* editor: the value in
// and out is a markdown string (prosemirror-markdown parse/serialize), so the
// on-disk format stays plain .md any tool can read. Linear-style affordances:
// markdown input rules ("# " → heading, "- " → list, "```" → code block,
// "**b**" → bold as you type) and a "/" slash menu for block insertion.
//
// One view per mount — docs.tsx keys this component by tab id, so switching
// tabs remounts a fresh view on the new tab's markdown. External value changes
// (a reader refresh) replace the doc in place.

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** ⌘S inside the editor — wired so save works while the view has focus */
  onSave?: () => void;
  autoFocus?: boolean;
}

// ---- input-rule helpers ----------------------------------------------------

// Inline mark rule: "**bold**", "*em*", "`code`" apply the mark as you type.
function markInputRule(regexp: RegExp, markType: MarkType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const [full, content] = match;
    if (!content) return null;
    const tr = state.tr;
    const textStart = start + full.indexOf(content);
    const textEnd = textStart + content.length;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    tr.addMark(start, start + content.length, markType.create());
    tr.removeStoredMark(markType); // don't keep typing bold after the closer
    return tr;
  });
}

function buildInputRules() {
  const rules: InputRule[] = [
    // "# " … "###### " → heading 1-6
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (m) => ({
      level: m[1].length,
    })),
    // "> " → blockquote
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    // "- " / "* " / "+ " → bullet list
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
    // "1. " → ordered list
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (m) => ({ order: +m[1] }),
      (m, node) => node.childCount + (node.attrs.order as number) === +m[1]
    ),
    // "```" → code block
    textblockTypeInputRule(/^```$/, schema.nodes.code_block),
    // "---" → divider
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start, end) => {
      return state.tr.replaceRangeWith(
        start,
        end,
        schema.nodes.horizontal_rule.create()
      );
    }),
    markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.strong),
    markInputRule(/(?:^|[^*\w])\*([^*\s][^*]*)\*$/, schema.marks.em),
    markInputRule(/`([^`]+)`$/, schema.marks.code),
  ];
  return inputRules({ rules });
}

// ---- placeholder -----------------------------------------------------------

function placeholderPlugin(text: string) {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const empty =
          doc.childCount === 1 &&
          doc.firstChild?.isTextblock &&
          doc.firstChild.content.size === 0;
        if (!empty) return null;
        const deco = Decoration.node(0, doc.firstChild!.nodeSize, {
          "data-placeholder": text,
          class: "hq-prose-empty",
        });
        return DecorationSet.create(doc, [deco]);
      },
    },
  });
}

// ---- slash menu ------------------------------------------------------------

type SlashItem = {
  key: string;
  label: string;
  hint: string; // the markdown shorthand, shown right-aligned like Linear's ⌘-hints
  icon: React.ReactNode;
  run: (view: EditorView) => void;
};

const SVG = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// Delete the "/query" the user typed, then apply the block command.
function applySlash(
  view: EditorView,
  cmd: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean
) {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const start = $from.start();
  dispatch(state.tr.delete(start, $from.pos));
  cmd(view.state, view.dispatch);
  view.focus();
}

const block =
  (type: NodeType, attrs?: Attrs) => (view: EditorView) =>
    applySlash(view, setBlockType(type, attrs));
const list = (type: NodeType) => (view: EditorView) =>
  applySlash(view, wrapInList(type));

const SLASH_ITEMS: SlashItem[] = [
  {
    key: "h1",
    label: "Heading 1",
    hint: "#",
    icon: <span className="font-mono text-[11px] font-semibold">H1</span>,
    run: block(schema.nodes.heading, { level: 1 }),
  },
  {
    key: "h2",
    label: "Heading 2",
    hint: "##",
    icon: <span className="font-mono text-[11px] font-semibold">H2</span>,
    run: block(schema.nodes.heading, { level: 2 }),
  },
  {
    key: "h3",
    label: "Heading 3",
    hint: "###",
    icon: <span className="font-mono text-[11px] font-semibold">H3</span>,
    run: block(schema.nodes.heading, { level: 3 }),
  },
  {
    key: "bullet",
    label: "Bulleted list",
    hint: "-",
    icon: (
      <svg {...SVG}>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="3.5" cy="6" r="0.5" fill="currentColor" />
        <circle cx="3.5" cy="12" r="0.5" fill="currentColor" />
        <circle cx="3.5" cy="18" r="0.5" fill="currentColor" />
      </svg>
    ),
    run: list(schema.nodes.bullet_list),
  },
  {
    key: "ordered",
    label: "Numbered list",
    hint: "1.",
    icon: (
      <svg {...SVG}>
        <path d="M10 6h11M10 12h11M10 18h11" />
        <path d="M4 6h1v4M4 10h2" />
        <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
      </svg>
    ),
    run: list(schema.nodes.ordered_list),
  },
  {
    key: "code",
    label: "Code block",
    hint: "```",
    icon: (
      <svg {...SVG}>
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
      </svg>
    ),
    run: block(schema.nodes.code_block),
  },
  {
    key: "quote",
    label: "Blockquote",
    hint: ">",
    icon: (
      <svg {...SVG}>
        <path d="M17 6H3M21 12H8M21 18H8" />
      </svg>
    ),
    run: (view) => applySlash(view, wrapIn(schema.nodes.blockquote)),
  },
  {
    key: "divider",
    label: "Divider",
    hint: "---",
    icon: (
      <svg {...SVG}>
        <path d="M3 12h18" />
      </svg>
    ),
    run: (view) => {
      const { state, dispatch } = view;
      const { $from } = state.selection;
      dispatch(
        state.tr
          .delete($from.start(), $from.pos)
          .replaceSelectionWith(schema.nodes.horizontal_rule.create())
      );
      view.focus();
    },
  },
];

type SlashState = { query: string; left: number; top: number } | null;

// ---- the component ---------------------------------------------------------

export default function ProseMirrorEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "Write, or type / for blocks…",
  onSave,
  autoFocus = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef(value);
  const [slash, setSlash] = useState<SlashState>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<{ open: boolean; index: number; items: SlashItem[] }>({
    open: false,
    index: 0,
    items: SLASH_ITEMS,
  });
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [onChange, onSave]);

  const filtered = useMemo(() => {
    if (!slash) return SLASH_ITEMS;
    const q = slash.query.toLowerCase();
    return SLASH_ITEMS.filter(
      (i) => i.label.toLowerCase().includes(q) || i.key.startsWith(q)
    );
  }, [slash]);
  // Mirrored into a ref so the (mount-once) keymap closures read live state.
  useEffect(() => {
    slashRef.current = {
      open: !!slash && filtered.length > 0,
      index: slashIndex,
      items: filtered,
    };
  }, [slash, filtered, slashIndex]);

  // Detect a "/query" at the head of the current textblock → open the menu at
  // the caret; anything else closes it.
  const readSlash = useCallback((view: EditorView) => {
    const { $from, empty } = view.state.selection;
    if (!empty || !$from.parent.isTextblock || $from.parent.type === schema.nodes.code_block) {
      setSlash(null);
      return;
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, "￼");
    const m = before.match(/^\/(\w*)$/);
    if (!m) {
      setSlash(null);
      return;
    }
    const coords = view.coordsAtPos($from.pos);
    setSlash((prev) => {
      if (prev?.query !== m[1]) setSlashIndex(0);
      return { query: m[1], left: coords.left, top: coords.bottom + 4 };
    });
  }, []);

  // Build the view once per mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let doc;
    try {
      doc = defaultMarkdownParser.parse(value);
    } catch {
      doc = schema.node("doc", null, [schema.node("paragraph")]);
    }
    const state = EditorState.create({
      schema,
      doc: doc ?? undefined,
      plugins: [
        buildInputRules(),
        // slash-menu keys run FIRST so ↑/↓/↵/esc drive the menu, not the doc
        keymap({
          ArrowDown: () => {
            const s = slashRef.current;
            if (!s.open) return false;
            setSlashIndex((i) => Math.min(i + 1, s.items.length - 1));
            return true;
          },
          ArrowUp: () => {
            const s = slashRef.current;
            if (!s.open) return false;
            setSlashIndex((i) => Math.max(i - 1, 0));
            return true;
          },
          Enter: () => {
            const s = slashRef.current;
            if (!s.open) return false;
            const item = s.items[s.index];
            if (item && viewRef.current) {
              item.run(viewRef.current);
              setSlash(null);
            }
            return true;
          },
          Escape: () => {
            if (!slashRef.current.open) return false;
            setSlash(null);
            return true;
          },
        }),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
          "Mod-b": toggleMark(schema.marks.strong),
          "Mod-i": toggleMark(schema.marks.em),
          "Mod-e": toggleMark(schema.marks.code),
          "Mod-Alt-1": setBlockType(schema.nodes.heading, { level: 1 }),
          "Mod-Alt-2": setBlockType(schema.nodes.heading, { level: 2 }),
          "Mod-Alt-3": setBlockType(schema.nodes.heading, { level: 3 }),
          "Mod-Alt-0": setBlockType(schema.nodes.paragraph),
          "Mod-Shift-8": wrapInList(schema.nodes.bullet_list),
          "Mod-Shift-9": wrapInList(schema.nodes.ordered_list),
          Enter: splitListItem(schema.nodes.list_item),
          Tab: sinkListItem(schema.nodes.list_item),
          "Shift-Tab": liftListItem(schema.nodes.list_item),
          "Shift-Enter": chainCommands(exitCode, (state, dispatch) => {
            if (dispatch)
              dispatch(
                state.tr
                  .replaceSelectionWith(schema.nodes.hard_break.create())
                  .scrollIntoView()
              );
            return true;
          }),
          "Mod-s": () => {
            onSaveRef.current?.();
            return true; // always swallow — never the browser save dialog
          },
        }),
        keymap(baseKeymap),
        history(),
        dropCursor({ color: "#3b82f6", width: 2 }),
        gapCursor(),
        placeholderPlugin(placeholder),
      ],
    });
    const view = new EditorView(host, {
      state,
      editable: () => !readOnly,
      attributes: {
        class: "hq-prose focus:outline-none",
        spellcheck: "false",
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const md = defaultMarkdownSerializer.serialize(next.doc);
          lastEmitted.current = md;
          onChangeRef.current(md);
        }
        readSlash(view);
      },
    });
    viewRef.current = view;
    if (autoFocus && !readOnly) {
      const end = view.state.doc.content.size;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end)))
      );
      view.focus();
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // mount-once: the doc lives in the view; docs.tsx remounts per tab (key=id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // External value change (reader refresh / hydrate) → replace the doc in place.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmitted.current) return;
    let doc;
    try {
      doc = defaultMarkdownParser.parse(value);
    } catch {
      return;
    }
    if (!doc) return;
    lastEmitted.current = value;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    view.dispatch(tr);
  }, [value]);

  const pick = (item: SlashItem) => {
    const view = viewRef.current;
    if (!view) return;
    item.run(view);
    setSlash(null);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={hostRef}
        className="hq-prose-host scrollbar-none min-h-0 flex-1 overflow-y-auto"
      />
      {slash && filtered.length > 0 && (
        <div
          style={{ left: slash.left, top: slash.top }}
          className="fixed z-50 flex w-56 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          {filtered.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keep the editor's selection
                pick(item);
              }}
              onMouseEnter={() => setSlashIndex(i)}
              className={`flex items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                i === slashIndex ? "bg-zinc-900 text-zinc-100" : "text-zinc-300"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="flex w-4 shrink-0 items-center justify-center text-zinc-500">
                  {item.icon}
                </span>
                {item.label}
              </span>
              <span className="font-mono text-[10px] text-zinc-600">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
