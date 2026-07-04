import DashboardShot from "./dashboard-shot";

// Section 2 — the real Analytics dashboard, moved down out of the hero (the hero
// now shows the product video). Same Linear frame chrome as the hero, with the
// live board inside: server-fed via /api/fleet/metrics, real ShapeCard
// components, no mockup. A modest heading anchors it so it doesn't compete with
// the hero's headline.
export default function DashboardSection() {
  return (
    <section id="dashboard" className="flex min-h-screen scroll-mt-24 items-center px-5 sm:px-8">
      <div className="mx-auto w-full max-w-6xl pb-20 pt-4">
        <h2
          className="max-w-2xl text-3xl leading-[1.08] tracking-[-0.02em] sm:text-[38px]"
          style={{ fontWeight: 590, color: "#f7f8f8" }}
        >
          Runtime usage data.
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: "#8a8f98" }}>
          Reading live token data per session, tool, turn, and user.
          <br />
          No warehouse. No ETL.
        </p>

        {/* the frame — the same Linear app-shot chrome as the hero */}
        <div className="relative mt-10 w-full">
          <div
            className="relative rounded-xl p-2"
            style={{ background: "#090a0b", boxShadow: "0px 7px 32px #00000059" }}
          >
            <div
              aria-hidden
              className="absolute inset-0 rounded-xl"
              style={{ background: "#101112", border: "1px solid #ffffff14" }}
            />
            <div
              className="relative overflow-hidden rounded-[7px]"
              style={{
                background: "#121314",
                border: "1px solid #ffffff14",
                boxShadow: "0 0 0 2px #0000001a",
                height: 640,
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: "radial-gradient(50% 50%, #ffffff0a 0%, transparent 90%)" }}
              />
              <div
                className="relative flex items-center gap-2.5 border-b px-4 py-2.5 font-mono text-[11px]"
                style={{ borderColor: "#ffffff0d" }}
              >
                <span className="size-2 rounded-full bg-green-500" />
                <span style={{ color: "#d0d6e0" }}>hq</span>
                <span style={{ color: "#62666d" }}>·</span>
                <span style={{ color: "#8a8f98" }}>analytics</span>
                <span className="ml-auto" style={{ color: "#62666d" }}>
                  live
                </span>
              </div>
              <div className="h-[calc(100%-37px)] overflow-hidden">
                <DashboardShot />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
