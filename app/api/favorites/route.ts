import { NextResponse } from "next/server";
import { getFavorites } from "@/lib/favorites";

export const dynamic = "force-dynamic";

// The Favorites scope — everything starred across all three stores, as hits the
// ⌘K list renders directly (same shape as /api/command-search).
export async function GET() {
  return NextResponse.json({ hits: getFavorites() });
}
