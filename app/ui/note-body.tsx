// Crude line-based markdown rendering — enough for vault notes in a
// wireframe, zero deps. Headings, bullets, numbered lists, plain text.
function inline(line: string): string {
  return line
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export default function NoteBody({ md }: { md: string }) {
  const lines = md.split("\n");
  return (
    <div className="flex flex-col gap-2 break-words text-sm leading-relaxed text-zinc-300">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return null;
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          const level = h[1].length;
          return (
            <p
              key={i}
              className={
                level <= 1
                  ? "mt-1 text-base font-semibold text-zinc-100"
                  : "mt-3 text-sm font-semibold text-zinc-100"
              }
            >
              {inline(h[2])}
            </p>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <p key={i} className="pl-4 before:mr-2 before:content-['·']">
              {inline(bullet[1])}
            </p>
          );
        }
        const num = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (num) {
          return (
            <p key={i} className="pl-4">
              {num[1]}. {inline(num[2])}
            </p>
          );
        }
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
