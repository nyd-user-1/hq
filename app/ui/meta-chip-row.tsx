import { Fragment } from "react";
import CopyCode from "@/app/ui/copy-code";

// A row of labeled, click-to-copy id chips — "Task <id> via session <id>" and
// the like. Presentational: each item is a text label followed by a CopyCode
// chip (the shown value, with an optional distinct copyText so a short id can
// display while the full one is copied). `divider` adds a faint hairline above
// so it can sit as a card footer under a body.
export type MetaChip = {
  label: string;
  value: string;
  copyText?: string;
};

export default function MetaChipRow({
  items,
  divider = false,
  className = "",
}: {
  items: MetaChip[];
  divider?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-zinc-600 ${
        divider ? "mt-2.5 border-t border-zinc-800/70 pt-2.5" : ""
      } ${className}`}
    >
      {items.map((it, i) => (
        <Fragment key={i}>
          {it.label}
          <CopyCode copyText={it.copyText}>{it.value}</CopyCode>
        </Fragment>
      ))}
    </p>
  );
}
