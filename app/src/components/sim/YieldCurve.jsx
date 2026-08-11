import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const CURVE = [
  { d: '7d', rate: 2.1 },
  { d: '30d', rate: 3.4 },
  { d: '90d', rate: 4.8 },
  { d: '180d', rate: 5.9 },
  { d: '1y', rate: 7.2 },
  { d: '2y', rate: 8.4 },
];

export default function YieldCurve() {
  return (
    <div className="rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">BTC-Native Yield Curve (mock)</div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Illustrative base rate derived from liquidity “leases” of different durations — a market-derived, BTC-native benchmark. Not real, not tradable.
      </p>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={CURVE} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="yc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1b2940" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#1b2940" />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#1b2940" tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: '#0c1320', border: '1px solid #1b2940', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(v) => [`${v}%`, 'lease rate']}
            />
            <Area type="monotone" dataKey="rate" stroke="#22d3ee" strokeWidth={2} fill="url(#yc)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}