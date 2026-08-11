import { motion } from 'framer-motion';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Radio, Waves } from 'lucide-react';

function ModeToggle({ mode, setMode }) {
  return (
    <div className="inline-flex rounded-lg border border-[#1b2940] bg-[#070b12] p-1">
      <button
        onClick={() => setMode('discrete')}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === 'discrete' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}
      >
        <Radio className="h-3.5 w-3.5" /> Discrete
      </button>
      <button
        onClick={() => setMode('streaming')}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === 'streaming' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}
      >
        <Waves className="h-3.5 w-3.5" /> Streaming
      </button>
    </div>
  );
}

export default function RebalanceVisualizer({ mode, setMode, history, tick, rebalanceEnabled }) {
  const data = history.slice(-60).map((h) => ({
    t: h.t,
    discrete: h.dD,
    streaming: h.dS,
  }));
  const streamingActive = mode === 'streaming' && rebalanceEnabled;

  return (
    <div className="rounded-2xl border border-[#1b2940] bg-[#0c1320] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Rebalancing Visualizer</div>
        <ModeToggle mode={mode} setMode={setMode} />
      </div>

      {/* Leg flow */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400/80">Spot Long</div>
          <div className="mt-1 text-sm font-semibold text-emerald-300">Collateral leg</div>
        </div>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-rose-400/80">Short Leg</div>
          <div className="mt-1 text-sm font-semibold text-rose-300">DLC hedge</div>
        </div>
      </div>

      {/* Packet channel */}
      <div className="relative mt-4 h-16 overflow-hidden rounded-xl border border-[#1b2940] bg-[#070b12]">
        <div className="absolute inset-0 flex items-center justify-between px-4">
          <span className="text-[10px] uppercase tracking-wider text-slate-600">L</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-600">S</span>
        </div>
        {streamingActive ? (
          <>
            <motion.div
              key={`f-${tick}`}
              className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.7)]"
              initial={{ left: '8%', opacity: 0 }}
              animate={{ left: ['8%', '92%'], opacity: [0, 1, 0] }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            />
            <motion.div
              key={`b-${tick}`}
              className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-cyan-300/70"
              initial={{ left: '92%', opacity: 0 }}
              animate={{ left: ['92%', '8%'], opacity: [0, 1, 0] }}
              transition={{ duration: 0.5, ease: 'easeInOut', delay: 0.05 }}
            />
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider text-cyan-400/70">
              streaming micro-corrections
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-slate-600">
            {mode === 'discrete' ? 'periodic re-strike · laggy jumps' : 'rebalancing paused'}
          </div>
        )}
      </div>

      {/* Gap chart */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>Unsettled drift since last checkpoint (bps of target)</span>
          <span className="flex gap-3">
            <span className="text-violet-400">● discrete</span>
            <span className="text-cyan-400">● streaming</span>
          </span>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: 9, fill: '#475569' }} stroke="#1b2940" />
              <Tooltip
                contentStyle={{ background: '#0c1320', border: '1px solid #1b2940', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <ReferenceLine y={0} stroke="#1b2940" />
              <Line type="monotone" dataKey="discrete" stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="streaming" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {mode === 'streaming'
            ? 'Each tick carries the price update and settles the hedge P&L in the same event — unsettled exposure (what a stale channel state could steal) stays pinned near zero.'
            : 'Between periodic re-strikes, unsettled P&L accumulates — this sawtooth is the stale-state theft bound ε growing until the next checkpoint settles it.'}
        </p>
      </div>
    </div>
  );
}