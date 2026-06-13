import { NextResponse } from "next/server";
import { efficiencyFor } from "@/lib/efficiency";

export const dynamic = "force-dynamic";

// Efficiency Mode's money conscience for the displayed session. node:fs stays
// server-side; the client polls this only while the mode is ON.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  return NextResponse.json(efficiencyFor(id));
}
