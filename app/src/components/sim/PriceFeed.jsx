import { Play, Pause, RotateCcw, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { P0 } from '@/hooks/useSyntheticSim';

export default function PriceFeed({ price, playing, setPlaying, setPriceManual, history, reset, mode }) {
  const fmt = (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const pct = ((price - P0) / P0) * 100;
  const floorKey = mode === 'streaming' ? 'floorS' : 'floorD';
  const spark = history.slice(-40).map((h) => ({ p: h.p, f: h[floorKey] }));

  return (
    <div className="rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider">BTC Spot Price Feed</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 border-[#1b2940] bg-transparent text-slate-300 hover:bg-[#16203300]" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span className="ml-1 text-xs">{playing ? 'Pause' : 'Play'}</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-[#1b2940] bg-transparent text-slate-300 hover:bg-[#16203300]" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-4">
        <div className="font-mono text-4xl font-semibold tracking-tight text-slate-50 tabular-nums">
          {fmt(price)}
        </div>
        <div className={`mb-1 font-mono text-sm font-medium tabular-nums ${pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </div>
      </div>

      <div className="mt-2 h-10 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="priceSpark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Area type="monotone" dataKey="p" stroke="#22d3ee" strokeWidth={1.5} fill="url(#priceSpark)" isAnimationActive={false} />
            <Area type="monotone" dataKey="f" stroke="#fb7185" strokeWidth={1} strokeDasharray="4 3" fill="none" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3">
        <Slider
          value={[price]}
          min={5000}
          max={120000}
          step={100}
          onValueChange={(v) => setPriceManual(v[0])}
        />
        <div className="mt-1.5 flex justify-between text-[10px] font-medium uppercase tracking-wider text-slate-500">
          <span>$5K</span>
          <span>Drag to nudge price · <span className="text-rose-400/80">dashed = collateral floor</span></span>
          <span>$120K</span>
        </div>
      </div>
    </div>
  );
}