import { TrendingUp, TrendingDown, DollarSign, ArrowDownToLine } from 'lucide-react';
import StabilityGauge from './StabilityGauge';

function Readout({ icon, label, value, sub, tone }) {
  const tones = {
    up: 'text-emerald-400',
    down: 'text-rose-400',
    neutral: 'text-cyan-300',
  };
  return (
    <div className="flex-1 rounded-2xl border border-[#1b2940] bg-[#0c1320] p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <span className={tones[tone]}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-3 font-mono text-3xl font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export default function PositionReadout({ longValue, shortPL, netValue, stability, imbalance, floorPrice, collateralBtc, price }) {
  const fmt = (v, d = 4) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(d)}`;
  const coverage = Math.max(0, (1 - floorPrice / price) * 100);
  const breached = price < floorPrice;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Readout
          icon={<TrendingUp className="h-4 w-4" />}
          label="Unhedged BTC"
          value={fmt(longValue)}
          sub="Counterfactual: the stack with no hedge"
          tone="up"
        />
        <Readout
          icon={<TrendingDown className="h-4 w-4" />}
          label="Hedge Contribution"
          value={fmt(shortPL)}
          sub="DLC payout · realized + unrealized"
          tone="down"
        />
        <Readout
          icon={<DollarSign className="h-4 w-4" />}
          label="Net Synthetic $"
          value={fmt(netValue)}
          sub="Exactly $1.00 above the floor — by contract"
          tone="neutral"
        />
        <StabilityGauge stability={stability} imbalance={imbalance} />
      </div>

      <div className={`flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl border px-4 py-2.5 text-[11px] ${breached ? 'border-rose-500/40 bg-rose-500/10' : 'border-[#1b2940] bg-[#0c1320]'}`}>
        <span className="flex items-center gap-1.5 text-slate-400">
          <ArrowDownToLine className={`h-3.5 w-3.5 ${breached ? 'text-rose-400' : 'text-cyan-400'}`} />
          <span className="font-semibold uppercase tracking-wider">Collateral floor</span>
        </span>
        <span className={`font-mono tabular-nums ${breached ? 'text-rose-300' : 'text-slate-200'}`}>
          ${Math.round(floorPrice).toLocaleString()}
        </span>
        <span className="text-slate-500">
          {breached
            ? 'BREACHED — provider collateral exhausted, position is long BTC'
            : `peg survives a −${coverage.toFixed(0)}% move before the next roll`}
        </span>
        <span className="ml-auto text-slate-500">
          Provider collateral <span className="font-mono text-slate-300">{collateralBtc.toFixed(3)} BTC</span>
        </span>
      </div>
    </div>
  );
}
