import { ShieldAlert } from 'lucide-react';

export default function SimulationBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-amber-200">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <p className="text-xs leading-relaxed font-medium">
        Simulation only — not financial infrastructure, not connected to real funds. All values are mocked in-memory.
      </p>
    </div>
  );
}
