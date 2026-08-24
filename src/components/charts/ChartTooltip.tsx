"use client";

// =============================================
// Shared chart tooltip
//
// Recharts' default tooltip is a white box with black text. On this app's
// forced-dark surface it reads as a rendering fault, which is most of why the
// old charts looked unfinished.
//
// One tooltip for every chart here, wearing the app's own tokens. Values are
// passed in already formatted -- charts format their own money through
// formatLL() rather than letting the tooltip guess.
// =============================================

export interface TooltipRow {
  label: string;
  value: string;
}

export function ChartTooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: TooltipRow[];
}) {
  return (
    <div className="pointer-events-none rounded-xl border border-white/10 bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-popover-foreground">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <p key={row.label} className="text-xs text-muted-foreground">
            {row.label}{" "}
            <span className="font-semibold text-popover-foreground tnum">{row.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
