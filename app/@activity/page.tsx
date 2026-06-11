import Boundary from "@/app/ui/boundary";

export default function ActivityHome() {
  return (
    <Boundary label="@activity/page.tsx">
      <p className="text-sm text-zinc-500">
        What the agents have been doing.{" "}
        <span className="text-zinc-300">Runs</span> is a placeholder until
        git/Vercel wiring; <span className="text-zinc-300">Usage</span> reads
        the Token Burn Log live from the vault.
      </p>
    </Boundary>
  );
}
