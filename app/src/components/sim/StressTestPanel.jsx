import { Zap, ZapOff, RadioTower, ShieldCheck, ShieldAlert, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

const alarmStyles = {
  crash: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  breach: 'border-rose-500/60 bg-rose-500/15 text-rose-100',
  drop: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  replace: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  unwind: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  recover: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

export default function StressTestPanel({ crash, crashDeep, dropCounterparty, restoreAll, alarm, netValue, rebalanceEnabled, unwinding, shortProviderId, providers, floorRatio, setFloorRatio, floorPrice }) {
  const hedged = Math.abs(netValue - 1) < 0.005;
  const activeProvider = providers.find((p) => p.id === shortProviderId);

  return (
    <div className="rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Stress-Test Panel</div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button onClick={crash} className="h-10 border-0 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 px-2">
          <Zap className="h-4 w-4" /> −28%
        </Button>
        <Button onClick={crashDeep} className="h-10 border-0 bg-rose-500/30 text-rose-100 hover:bg-rose-500/40 px-2">
          <ZapOff className="h-4 w-4" /> −60%
        </Button>
        <Button onClick={dropCounterparty} className="h-10 border-0 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 px-2">
          <RadioTower className="h-4 w-4" /> Drop
        </Button>
      </div>
      <Button onClick={restoreAll} variant="outline" className="mt-2 h-8 w-full border-[#1b2940] bg-transparent text-slate-400 hover:bg-[#16203300]">
        <RotateCcw className="h-3.5 w-3.5" /> Restore all providers
      </Button>

      {/* Floor ratio */}
      <div className="mt-4 rounded-xl border border-[#1b2940] bg-[#070b12] p-3">
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>Contract floor ratio</span>
          <span className="font-mono text-slate-300">{(floorRatio * 100).toFixed(0)}% of roll price</span>
        </div>
        <Slider
          className="mt-2"
          value={[floorRatio]}
          min={0.3}
          max={0.9}
          step={0.05}
          onValueChange={(v) => setFloorRatio(v[0])}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Lower floor = deeper crash coverage but more provider collateral locked per dollar.
          Peg currently holds down to <span className="font-mono text-slate-300">${Math.round(floorPrice).toLocaleString()}</span>; below that, no amount of streaming saves it.
        </p>
      </div>

      {/* SAFE vs HEDGED */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Safe</span>
          </div>
          <div className="mt-1 text-sm font-semibold text-emerald-300">No theft · penalty enforced</div>
          <div className="text-[11px] text-slate-500">Funds are never custodied by a counterparty.</div>
        </div>
        <div className={`rounded-xl border p-3 ${hedged ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
          <div className={`flex items-center gap-1.5 ${hedged ? 'text-cyan-400' : 'text-rose-400'}`}>
            {hedged ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            <span className="text-[10px] font-semibold uppercase tracking-wider">Hedged</span>
          </div>
          <div className={`mt-1 text-sm font-semibold ${hedged ? 'text-cyan-300' : 'text-rose-300'}`}>
            {hedged ? 'Peg maintained' : 'Peg broken'}
          </div>
          <div className="text-[11px] text-slate-500">Net = ${netValue.toFixed(4)}</div>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Safety alone doesn't keep the dollar stable — <span className="text-slate-300">continuity does</span>. A SAFE position can still lose its peg two ways: the short-side stream goes silent with no replacement, or price falls through the collateral floor. A breach realizes the loss permanently — the target does not snap back when price recovers.
      </p>

      {/* Status line */}
      <div className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex justify-between text-slate-500">
          <span>Active short provider</span>
          <span className="font-mono text-slate-300">{activeProvider ? activeProvider.name : '— none —'}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Rebalancing stream</span>
          <span className={`font-mono ${rebalanceEnabled ? 'text-emerald-400' : 'text-rose-400'}`}>{rebalanceEnabled ? 'live' : 'silent — floor frozen'}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Fallback state</span>
          <span className={`font-mono ${unwinding ? 'text-orange-400' : 'text-slate-300'}`}>{unwinding ? 'graceful unwind' : 'standby'}</span>
        </div>
      </div>

      {alarm && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${alarmStyles[alarm.type] || ''}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{alarm.msg}</span>
        </div>
      )}
    </div>
  );
}
