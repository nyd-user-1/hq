import { NextResponse } from "next/server";
import {
  getTodos,
  addTodo,
  updateTodo,
  removeTodo,
  reorderTodos,
} from "@/lib/todo";

export const dynamic = "force-dynamic";

// The HQ-native To Do store's HTTP face. The /todo skill POSTs here; draggable
// cards PATCH (done/text) / DELETE / PUT (reorder). No vault, no DB — lib/todo
// reads/writes ~/.claude/hq/todo.json.

export async function GET() {
  return NextResponse.json({ items: getTodos() });
}

export async function POST(req: Request) {
  const { text, body, addedBy } = await req.json().catch(() => ({}));
  if (typeof text !== "string" || !text.trim()) {
    return new NextResponse("text required", { status: 400 });
  }
  return NextResponse.json({ item: addTodo(text, { body, addedBy }) });
}

export async function PATCH(req: Request) {
  const { id, text, done, claimedBy, body } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !id) {
    return new NextResponse("id required", { status: 400 });
  }
  const item = updateTodo(id, { text, done, claimedBy, body });
  if (!item) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new NextResponse("id required", { status: 400 });
  return removeTodo(id)
    ? NextResponse.json({ ok: true })
    : new NextResponse("not found", { status: 404 });
}

export async function PUT(req: Request) {
  const { order } = await req.json().catch(() => ({}));
  if (!Array.isArray(order)) {
    return new NextResponse("order array required", { status: 400 });
  }
  return NextResponse.json({ items: reorderTodos(order) });
}
