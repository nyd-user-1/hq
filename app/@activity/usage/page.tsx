import Boundary from "@/app/ui/boundary";
import NoteBody from "@/app/ui/note-body";
import { getNote } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default function Usage() {
  const note = getNote("!hq/Token Burn Log.md");
  return (
    <Boundary label="@activity/usage/page.tsx">
      {note ? (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <NoteBody md={note} />
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          Token Burn Log.md not found in the vault
        </p>
      )}
    </Boundary>
  );
}
