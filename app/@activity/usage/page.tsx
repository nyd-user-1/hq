import { getNote } from "@/lib/vault";
import NoteBody from "@/app/ui/note-body";

export const dynamic = "force-dynamic";

export default function Usage() {
  const note = getNote("!hq/Token Burn Log.md");
  if (!note) {
    return (
      <p className="text-sm text-zinc-600">
        Token Burn Log.md not found in the vault
      </p>
    );
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto pr-1">
      <NoteBody md={note} />
    </div>
  );
}
