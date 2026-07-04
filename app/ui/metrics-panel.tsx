"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useMetrics, METRICS_PANELS, type MetricsKey } from "@/app/ui/metrics-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import UsagePanel from "@/app/ui/usage-panel";
import CallsPanel from "@/app/ui/calls-panel";
import GuardrailsPanel from "@/app/ui/guardrails-panel";
import SavingsPanel from "@/app/ui/savings-panel";
import AuditPanel from "@/app/ui/audit-panel";
import KpiPanel from "@/app/ui/kpi-panel";
import ApiPanel from "@/app/ui/api-panel";
import FirehosePanel from "@/app/ui/firehose-panel";
import { useUsage } from "@/app/ui/usage-state";
import { useCalls } from "@/app/ui/calls-state";
import { useGuardrails } from "@/app/ui/guardrails-state";
import { useSavings } from "@/app/ui/savings-state";
import { useAudit } from "@/app/ui/audit-state";
import { useKpis } from "@/app/ui/kpi-state";
import { useApi } from "@/app/ui/api-state";
import { useFirehose } from "@/app/ui/firehose-state";

// The Metrics container — Usage · Calls · Guardrails · Savings · Memory Audit · KPIs ·
// API · Firehose, swapping in place via the shared GroupSwitchChip + GroupNavChips.
// Replaces the old terminal-nav-menu Metrics flyout.
export default function MetricsPanel() {
  const { open, setOpen, active, setActive } = useMetrics();
  const meta = METRICS_PANELS.find((p) => p.key === active) ?? METRICS_PANELS[0];
  const standalone: Record<string, (v: boolean) => void> = {
    usage: useUsage().setOpen,
    calls: useCalls().setOpen,
    guardrails: useGuardrails().setOpen,
    savings: useSavings().setOpen,
    audit: useAudit().setOpen,
    kpi: useKpis().setOpen,
    api: useApi().setOpen,
    firehose: useFirehose().setOpen,
  };
  const select = (k: string) => setActive(k as MetricsKey);

  return (
    <AppPanel rootId="metrics-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<GroupSwitchChip file={meta.file} active={active} members={METRICS_PANELS} onSelect={select} onPopOut={(k) => standalone[k](true)} />}
        trail={<GroupNavChips active={active} members={METRICS_PANELS} onSelect={select} />}
      >
        {active === "usage" && <UsagePanel embedded />}
        {active === "calls" && <CallsPanel embedded />}
        {active === "guardrails" && <GuardrailsPanel embedded />}
        {active === "savings" && <SavingsPanel embedded />}
        {active === "audit" && <AuditPanel embedded />}
        {active === "kpi" && <KpiPanel embedded />}
        {active === "api" && <ApiPanel embedded />}
        {active === "firehose" && <FirehosePanel embedded />}
      </Boundary>
    </AppPanel>
  );
}
