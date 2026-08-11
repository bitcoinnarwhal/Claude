import { Plus, Trash2, Droplet, Landmark, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';

const typeIcon = {
  LP: Droplet,
  Treasury: Landmark,
  Exchange: Repeat,
};

export default function LiquidityLayer({ providers, addProvider, removeProvider, shortProviderId, stability, activeCount }) {
  const resilience = Math.min(100, activeCount * 22);
  const resilienceColor = resilience > 66 ? 'text-emerald-400' : resilience > 33 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Liquidity Layer</div>
        <Button onClick={addProvider} size="sm" className="h-8 border-0 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30">
          <Plus className="h-3.5 w-3.5" /> Add provider
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#1b2940] bg-[#070b12] p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Active providers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100">{activeCount}</div>
        </div>
        <div className="rounded-xl border border-[#1b2940] bg-[#070b12] p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Peg resilience</div>
          <div className={`mt-1 font-mono text-2xl font-semibold ${resilienceColor}`}>{resilience}%</div>
        </div>
        <div className="rounded-xl border border-[#1b2940] bg-[#070b12] p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Live stability</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-cyan-300">{stability.toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {providers.map((p) => {
          const Icon = typeIcon[p.type] || Droplet;
          const isShort = p.id === shortProviderId;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border p-3 transition ${p.active ? 'border-[#1b2940] bg-[#070b12]' : 'border-rose-500/20 bg-rose-500/5 opacity-60'}`}
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${p.active ? 'bg-[#16203a] text-cyan-300' : 'bg-rose-500/10 text-rose-400'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{p.name}</span>
                  <span className="rounded bg-[#16203a] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">{p.type}</span>
                  {isShort && p.active && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">active short</span>
                  )}
                  {!p.active && (
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-rose-300">dropped</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">Standby yield <span className="font-mono text-slate-400">{p.yield.toFixed(2)}%</span></div>
              </div>
              <button
                onClick={() => removeProvider(p.id)}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-[#16203a] hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        With many diversified providers, one dropping is a small wobble — a replacement is pulled from the standby pool instantly. With a single provider, its drop is a collapse. Add and remove providers above and watch the peg respond.
      </p>
    </div>
  );
}
