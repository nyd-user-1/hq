import Boundary from "@/app/ui/boundary";

export default function ConsoleHome() {
  return (
    <Boundary label="@console/page.tsx">
      <p className="text-sm text-zinc-500">
        Buttons that will eventually do things — wrap{" "}
        <code className="font-mono text-zinc-300">claude -p</code> and{" "}
        <code className="font-mono text-zinc-300">/schedule</code>. Dead in v0.
      </p>
    </Boundary>
  );
}
