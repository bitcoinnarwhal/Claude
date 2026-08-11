export default function StabilityGauge({ stability, imbalance }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, stability / 100));
  const offset = c * (1 - frac);
  const bps = imbalance * 10000;

  const color = stability > 85 ? '#34d399' : stability > 50 ? '#fbbf24' : '#fb7185';

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Peg Stability</div>
      <div className="relative mt-3 h-[170px] w-[170px]">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 170 170">
          <circle cx="85" cy="85" r={r} fill="none" stroke="#16203a" strokeWidth="12" />
          <circle
            cx="85" cy="85" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color }}>{stability.toFixed(0)}<span className="text-lg">%</span></div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">tracking $1.00</div>
        </div>
      </div>
      <div className="mt-2 text-center">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">Deviation</div>
        <div className="font-mono text-sm tabular-nums text-slate-300">{bps >= 0 ? '+' : ''}{bps.toFixed(1)} bps</div>
      </div>
    </div>
  );
}
