import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSyntheticSim } from '@/hooks/useSyntheticSim';
import SimulationBanner from '@/components/sim/SimulationBanner';
import PriceFeed from '@/components/sim/PriceFeed';
import PositionReadout from '@/components/sim/PositionReadout';
import RebalanceVisualizer from '@/components/sim/RebalanceVisualizer';
import StressTestPanel from '@/components/sim/StressTestPanel';
import LiquidityLayer from '@/components/sim/LiquidityLayer';
import YieldCurve from '@/components/sim/YieldCurve';

export default function SyntheticSats() {
  const sim = useSyntheticSim();

  return (
    <div className="min-h-screen bg-[#06090f] text-slate-200">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                <span className="font-mono text-lg font-bold text-cyan-300">₿</span>
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">Synthetic Sats</h1>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">A self-balancing, Bitcoin-native synthetic dollar — real payout-curve simulator with an honest collateral floor.</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1b2940] bg-[#0c1320] px-3 py-1">
              <span className={`h-1.5 w-1.5 rounded-full ${sim.playing ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {sim.playing ? 'feed live' : 'feed paused'}
            </span>
          </div>
        </header>

        <div className="mt-4">
          <SimulationBanner />
        </div>

        {/* Main grid */}
        <Tabs defaultValue="position" className="mt-5">
          <TabsList className="border border-[#1b2940] bg-[#0c1320]">
            <TabsTrigger value="position" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">The Position</TabsTrigger>
            <TabsTrigger value="liquidity" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">Liquidity Layer</TabsTrigger>
            <TabsTrigger value="yield" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">Yield Curve</TabsTrigger>
          </TabsList>

          <TabsContent value="position" className="mt-4 space-y-4">
            <PriceFeed
              price={sim.price}
              playing={sim.playing}
              setPlaying={sim.setPlaying}
              setPriceManual={sim.setPriceManual}
              history={sim.history}
              reset={sim.reset}
              mode={sim.mode}
            />
            <PositionReadout
              longValue={sim.longValue}
              shortPL={sim.shortPL}
              netValue={sim.netValue}
              stability={sim.stability}
              imbalance={sim.imbalance}
              floorPrice={sim.floorPrice}
              collateralBtc={sim.collateralBtc}
              price={sim.price}
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RebalanceVisualizer
                mode={sim.mode}
                setMode={sim.setMode}
                history={sim.history}
                tick={sim.tick}
                rebalanceEnabled={sim.rebalanceEnabled}
              />
              <StressTestPanel
                crash={sim.crash}
                crashDeep={sim.crashDeep}
                dropCounterparty={sim.dropCounterparty}
                restoreAll={sim.restoreAll}
                alarm={sim.alarm}
                netValue={sim.netValue}
                rebalanceEnabled={sim.rebalanceEnabled}
                unwinding={sim.unwinding}
                shortProviderId={sim.shortProviderId}
                providers={sim.providers}
                floorRatio={sim.floorRatio}
                setFloorRatio={sim.setFloorRatio}
                floorPrice={sim.floorPrice}
              />
            </div>
          </TabsContent>

          <TabsContent value="liquidity" className="mt-4">
            <LiquidityLayer
              providers={sim.providers}
              addProvider={sim.addProvider}
              removeProvider={sim.removeProvider}
              shortProviderId={sim.shortProviderId}
              stability={sim.stability}
              activeCount={sim.activeCount}
            />
          </TabsContent>

          <TabsContent value="yield" className="mt-4">
            <YieldCurve />
          </TabsContent>
        </Tabs>

        <footer className="mt-8 border-t border-[#1b2940] pt-4 text-center text-[11px] text-slate-600">
          Synthetic Sats · educational mock · no real keys, no real money, no external connections.
        </footer>
      </div>
    </div>
  );
}
