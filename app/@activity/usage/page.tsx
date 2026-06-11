import Boundary from "@/app/ui/boundary";
import NoteBody from "@/app/ui/note-body";
import TokenMeter from "@/app/ui/token-meter";
import { getNote } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default function Usage() {
  const note = getNote("!hq/Token Burn Log.md");
  return (
    <Boundary label="@activity/usage/page.tsx">
      <TokenMeter />
      <div className="border-t border-zinc-800 pt-4">
        {note ? (
          <div className="scrollbar-none max-h-[40vh] overflow-y-auto">
            <NoteBody md={note} />
          </div>
        ) : (
          <p className="text-sm text-zinc-600">
            Token Burn Log.md not found in the vault
          </p>
        )}
      </div>
    </Boundary>
  );
}
