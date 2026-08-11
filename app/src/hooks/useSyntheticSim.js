import { useState, useEffect, useRef, useCallback } from 'react';

export const P0 = 50000;
export const B0 = 1; // holder stack, BTC
export const V0 = B0 * P0; // stable dollar target, USD
const TICK_MS = 220;
const DISCRETE_REBAL_TICKS = 8;
const DEFAULT_FLOOR_RATIO = 0.5;

const INITIAL_PROVIDERS = [
  { id: 'A', name: 'Provider A', type: 'LP', active: true, yield: 4.2 },
  { id: 'B', name: 'Provider B', type: 'LP', active: true, yield: 3.8 },
  { id: 'C', name: 'Provider C', type: 'LP', active: true, yield: 4.5 },
  { id: 'T', name: 'Treasury Holder', type: 'Treasury', active: true, yield: 2.1 },
  { id: 'E', name: 'Exchange Desk', type: 'Exchange', active: true, yield: 3.1 },
];

export { INITIAL_PROVIDERS };

// Real hedge math, mirroring simulation/synthdollar_sim/hedge.py in the repo.
// The contract pays clip(V/P - H, -H, C) BTC at price P: exactly stable for
// P >= floor = V/(H + C); below the floor, provider collateral C is exhausted
// and the position degrades to long BTC.
const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function payout(p, st) {
  return clip(st.V / p - st.H, -st.H, st.C);
}

// Provider posts enough collateral to place the floor at floorRatio * p
// (clipped at 0: above ~P0/floorRatio the stack alone covers the target).
function withContract(H, V, p, floorRatio) {
  const C = Math.max(0, V / (floorRatio * p) - H);
  return { H, V, C, floor: V / (H + C) };
}

// A roll settles the outstanding payout and re-centers the floor. A roll that
// happens below the floor realizes the loss: the provider's C is exhausted and
// the stable target V shrinks permanently to what the BTC is now worth.
function rollContract(st, p, floorRatio) {
  const H2 = st.H + payout(p, st);
  const V2 = p < st.floor ? H2 * p : st.V;
  return withContract(H2, V2, p, floorRatio);
}

export function useSyntheticSim() {
  const [price, setPrice] = useState(P0);
  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState('streaming');
  const [providers, setProviders] = useState(INITIAL_PROVIDERS);
  const [shortProviderId, setShortProviderId] = useState('A');
  const [crashActive, setCrashActive] = useState(false);
  const [alarm, setAlarm] = useState(null);
  const [unwinding, setUnwinding] = useState(false);
  const [rebalanceEnabled, setRebalanceEnabled] = useState(true);
  const [floorRatio, setFloorRatio] = useState(DEFAULT_FLOOR_RATIO);
  const [netDiscrete, setNetDiscrete] = useState(1);
  const [netStreaming, setNetStreaming] = useState(1);
  const [snap, setSnap] = useState(() => {
    const c = withContract(B0, V0, P0, DEFAULT_FLOOR_RATIO);
    return { floorS: c.floor, floorD: c.floor, cS: c.C, cD: c.C, dS: 0, dD: 0 };
  });
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState([]);

  const stS = useRef(withContract(B0, V0, P0, DEFAULT_FLOOR_RATIO));
  const stD = useRef(withContract(B0, V0, P0, DEFAULT_FLOOR_RATIO));
  const tickCount = useRef(0);
  const priceRef = useRef(P0);
  const rebalanceEnabledRef = useRef(true);
  const floorRatioRef = useRef(DEFAULT_FLOOR_RATIO);
  const modeRef = useRef('streaming');
  const breachRef = useRef(false);
  const providersRef = useRef(INITIAL_PROVIDERS);
  const shortProviderIdRef = useRef('A');
  const idCounter = useRef(0);

  useEffect(() => { rebalanceEnabledRef.current = rebalanceEnabled; }, [rebalanceEnabled]);
  useEffect(() => { floorRatioRef.current = floorRatio; }, [floorRatio]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { providersRef.current = providers; }, [providers]);
  useEffect(() => { shortProviderIdRef.current = shortProviderId; }, [shortProviderId]);

  const applyPrice = useCallback((p, { rolls }) => {
    const fr = floorRatioRef.current;
    if (rolls && rebalanceEnabledRef.current) {
      stS.current = rollContract(stS.current, p, fr);
      if (tickCount.current % DISCRETE_REBAL_TICKS === 0) {
        stD.current = rollContract(stD.current, p, fr);
      }
    }
    // Unsettled drift = |payout| marked in USD: what a stale channel state
    // could steal before the next checkpoint settles it (the epsilon bound).
    const mk = (st) => {
      const q = payout(p, st);
      return { net: ((st.H + q) * p) / V0, drift: ((Math.abs(q) * p) / V0) * 10000 };
    };
    const s = mk(stS.current);
    const d = mk(stD.current);
    setPrice(p);
    setNetStreaming(s.net);
    setNetDiscrete(d.net);
    setSnap({
      floorS: stS.current.floor, floorD: stD.current.floor,
      cS: stS.current.C, cD: stD.current.C,
      dS: s.drift, dD: d.drift,
    });
    const activeSt = modeRef.current === 'streaming' ? stS.current : stD.current;
    const breached = p < activeSt.floor;
    if (breached && !breachRef.current) {
      setAlarm({
        type: 'breach',
        msg: `Below collateral floor $${Math.round(activeSt.floor).toLocaleString()} — provider collateral exhausted, peg broken`,
      });
    } else if (!breached && breachRef.current) {
      setAlarm((a) => (a && a.type === 'breach' ? null : a));
    }
    breachRef.current = breached;
    return { s, d };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      let p = priceRef.current;
      const vol = p * 0.004;
      p += (Math.random() - 0.5) * vol * 2;
      if (p < 1000) p = 1000;
      priceRef.current = p;
      const t = tickCount.current + 1;
      tickCount.current = t;
      const { s, d } = applyPrice(p, { rolls: true });
      setTick(t);
      setHistory((h) => [...h.slice(-119), {
        t, p,
        floorS: stS.current.floor, floorD: stD.current.floor,
        dS: s.drift, dD: d.drift,
      }]);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, applyPrice]);

  // Manual price moves do NOT roll the contract: pause the feed and drag the
  // slider to explore the current contract's payout curve, floor included.
  const setPriceManual = useCallback((p) => {
    priceRef.current = p;
    applyPrice(p, { rolls: false });
  }, [applyPrice]);

  const applyShock = useCallback((factor, label) => {
    const p = priceRef.current * factor;
    priceRef.current = p;
    applyPrice(p, { rolls: false });
    setCrashActive(true);
    setAlarm({ type: 'crash', msg: `BTC crash: ${label} shock applied` });
    setTimeout(() => setCrashActive(false), 4500);
    setTimeout(() => setAlarm((a) => (a && a.type === 'crash' ? null : a)), 4500);
  }, [applyPrice]);

  const crash = useCallback(() => applyShock(0.72, '−28%'), [applyShock]);
  const crashDeep = useCallback(() => applyShock(0.40, '−60%'), [applyShock]);

  const dropCounterparty = useCallback(() => {
    const cur = shortProviderIdRef.current;
    setProviders((ps) => ps.map((x) => (x.id === cur ? { ...x, active: false } : x)));
    setAlarm({ type: 'drop', msg: `Stream silence from ${cur} — counterparty drop detected. Floor frozen at last enforceable contract.` });
    setRebalanceEnabled(false);
    const standby = providersRef.current.find((x) => x.active && x.id !== cur);
    if (standby) {
      setTimeout(() => {
        setShortProviderId(standby.id);
        setRebalanceEnabled(true);
        setAlarm({ type: 'replace', msg: `Replacement online: ${standby.name} pulled from standby pool` });
        setTimeout(() => setAlarm((a) => (a && a.type === 'replace' ? null : a)), 3000);
      }, 2500);
    } else {
      setUnwinding(true);
      setAlarm({ type: 'unwind', msg: 'No replacement — graceful unwind initiated' });
      setTimeout(() => {
        setProviders((ps) => ps.map((x) => (x.id === cur ? { ...x, active: true } : x)));
        setShortProviderId(cur);
        setRebalanceEnabled(true);
        setUnwinding(false);
        setAlarm({ type: 'recover', msg: 'Unwind complete — position safely restored' });
        setTimeout(() => setAlarm((a) => (a && a.type === 'recover' ? null : a)), 3000);
      }, 4500);
    }
  }, []);

  const restoreAll = useCallback(() => {
    setProviders((ps) => ps.map((x) => ({ ...x, active: true })));
    setRebalanceEnabled(true);
    setUnwinding(false);
    setAlarm(null);
    setCrashActive(false);
  }, []);

  const addProvider = useCallback(() => {
    idCounter.current += 1;
    const n = idCounter.current;
    const letters = 'XYZ';
    const label = letters[(n - 1) % letters.length] + (n > 3 ? Math.floor((n - 1) / 3) : '');
    const np = {
      id: `LP${Date.now()}`,
      name: `Provider ${label}`,
      type: 'LP',
      active: true,
      yield: +(3 + Math.random() * 2).toFixed(2),
    };
    setProviders((ps) => [...ps, np]);
  }, []);

  const removeProvider = useCallback((id) => {
    setProviders((ps) => ps.filter((x) => x.id !== id));
  }, []);

  const reset = useCallback(() => {
    const fr = floorRatioRef.current;
    priceRef.current = P0;
    stS.current = withContract(B0, V0, P0, fr);
    stD.current = withContract(B0, V0, P0, fr);
    tickCount.current = 0;
    breachRef.current = false;
    setPrice(P0);
    setProviders(INITIAL_PROVIDERS);
    setShortProviderId('A');
    setRebalanceEnabled(true);
    setUnwinding(false);
    setAlarm(null);
    setCrashActive(false);
    setHistory([]);
    setNetDiscrete(1);
    setNetStreaming(1);
    setTick(0);
    const c = withContract(B0, V0, P0, fr);
    setSnap({ floorS: c.floor, floorD: c.floor, cS: c.C, cD: c.C, dS: 0, dD: 0 });
  }, []);

  const isStreaming = mode === 'streaming';
  const netValue = isStreaming ? netStreaming : netDiscrete;
  const longValue = price / P0; // counterfactual: the unhedged stack
  const shortPL = netValue - longValue; // hedge contribution, realized + unrealized
  const floorPrice = isStreaming ? snap.floorS : snap.floorD;
  const collateralBtc = isStreaming ? snap.cS : snap.cD;
  const driftBps = isStreaming ? snap.dS : snap.dD;
  const imbalance = netValue - 1; // signed depeg; 0 exactly while above the floor
  const stability = Math.max(0, 100 - Math.abs(imbalance) * 1000);
  const activeCount = providers.filter((p) => p.active).length;

  return {
    price, playing, setPlaying, mode, setMode,
    providers, shortProviderId, crashActive, alarm, unwinding, rebalanceEnabled,
    netDiscrete, netStreaming, tick, history,
    longValue, shortPL, netValue, imbalance, stability, activeCount,
    floorRatio, setFloorRatio, floorPrice, collateralBtc, driftBps,
    setPriceManual, crash, crashDeep, dropCounterparty, restoreAll,
    addProvider, removeProvider, reset,
  };
}
