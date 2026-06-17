import Boundary from "@/app/ui/boundary";
import { getTodos } from "@/lib/todo";
import TodoList from "@/app/ui/todo-list";

export const dynamic = "force-dynamic";

// To Do = HQ's own list, read from the HQ-native store (~/.claude/hq/todo.json).
// No vault/Obsidian dependency — it ships and works for any Claude Code user.
export default function ToDo() {
  return (
    <Boundary topOnly bleedX label="@panel/todo/page.tsx">
      <TodoList initial={getTodos()} />
    </Boundary>
  );
}
