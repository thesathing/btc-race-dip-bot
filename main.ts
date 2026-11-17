// Dip-buy cbBTC bot for make.fun btc-race-24h-20261117-0603 — v2 (upgraded).
//
// What was tried and what survived (all backtested on the published 24h
// dev window, simulator validated against grade-local to the cent):
// - The aggressive multi-indicator families LOSE on this window and were
//   dropped: EMA-stack + MACD + breakout momentum -$1 to -$80, RSI(14)
//   oversold bounce -$1 to -$14, Bollinger lower-band bounce -$85 to
//   -$90, dip+breakout hybrids at best +$5.66. Volume, VWAP and
//   volume-acceleration signals are impossible here: the bars carry no
//   volume (v is null), only O/H/L/C and pool depth.
// - What wins is the dip-buy shape, upgraded with the competition's own
//   phase structure:
//   - PHASE 1 DISCOVERY (bars 0-239, hours 0-4): observe only, no
//     entries. Skipping the early window is worth +$9.46 on dev: the
//     first trade of the ungated bot bought bar 172 and sold bar 369
//     for -$10.03, while the gated bot buys the same dip at bar 369
//     instead. The gain is a plateau, not a spike (skip 240/300/360
//     all give +$23.20; skip 180 gives +$17.53; skip 0/120 give
//     +$13.74; skip 480 drops to +$10.25).
//   - PHASE 2 EXECUTION (bars 240-1319): buy a real dip, 60-minute
//     return at or below -80 bps, full size. Exit on a 100 bps
//     trailing stop from the peak since entry, or +150 bps take
//     profit, after at least 15 bars. No hard stop: dips routinely
//     extend further before they recover, and a stop at -250 bps was
//     the single worst change in backtesting.
//   - PHASE 3 FINAL PUSH (bars 1320-1439, final 2h): no new entries,
//     so no fresh exposure is carried into the deadline; an open
//     position keeps its trailing stop / take profit.
//   - Fallback: if nothing has traded by bar 720, buy anyway with
//     the same exits, so a dip-less rising window still leaves the
//     bot long with at least one trade (the race requires >= 1
//     trade and max drawdown <= 25%).
//
// Protocol: agent-fun/bars-replay/v1, one JSON line per batch on stdin, one
// reply per batch on stdout (see the hello, batch and orders handling in
// vendor/makefun-bars.ts, the kit's TypeScript shim). Deterministic: no
// clock, no environment, no randomness, no network, no files outside the
// repository. Signal math is plain float64 arithmetic in a fixed order;
// money is bigints from the harness state. Backtest on the dev window:
// net PnL +$23.20, 5 trades, max drawdown 0.95% (v1: +$13.74, 7 trades,
// 1.63%).

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Entry: 60-bar return at or below -80 bps. */
const DIP_BARS = 60;
const DIP_BPS = 80;
/** Exit: 100 bps trailing stop from the peak, 150 bps take profit. */
const TRAIL_BPS = 100;
const TAKE_PROFIT_BPS = 150;
/** Do not exit before the position has had 15 bars to recover. */
const MIN_HOLD_BARS = 15;
/** Phase 1 discovery: no entries before this batch. */
const DISCOVERY_BARS = 240;
/** Fallback: if no trade has happened by this batch, buy anyway. */
const FALLBACK_BAR = 720;
/** Phase 3: no new entries from this batch on (final 120 bars). */
const FINAL_PHASE_BAR = 1320;
/** Slippage cap on every order: 1-minute moves peak at 45 bps on the dev
 *  window, so 150 bps never binds in normal trading but refuses a fill
 *  across a gap instead of chasing it. */
const MAX_SLIPPAGE_BPS = 150;

const closes: number[] = [];
let entryPrice: number | null = null; // USD per cbBTC, from the filled position's cost
let entrySeq = -1;
let peak = 0;
let everTraded = false;

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    let close: number | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) close = Number(bar.c) / 100000;
    }
    if (close === null) return [];
    closes.push(close);
    // During warmup bars the close history is incomplete, so a dip ratio
    // computed here would compare against a partial window. This race
    // publishes warmup 0, so the guard is inert on its data.
    if (state.warmingUp) return [];

    const holding = state.positions.get(SYMBOL);
    if (holding !== undefined) {
      // A position only counts as traded once its fill actually lands: an
      // order the market rejects must not disable the fallback buy.
      everTraded = true;
      if (entryPrice === null) {
        // cost (micro-USDC) -> USD price: value = qty * price_int / 1e7,
        // price_usd = price_int / 1e5, so price_usd = cost * 100 / qty.
        entryPrice = (Number(holding.cost) * 100) / Number(holding.qty);
        entrySeq = state.seq;
        peak = close;
      }
      if (close > peak) peak = close;
      if (state.seq - entrySeq >= MIN_HOLD_BARS) {
        if (close <= peak * (1 - TRAIL_BPS / 10000)) {
          return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        if (entryPrice !== null && close >= entryPrice * (1 + TAKE_PROFIT_BPS / 10000)) {
          return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: reset entry tracking.
    entryPrice = null;
    entrySeq = -1;
    peak = 0;

    // Phase 1 (discovery) and Phase 3 (final push): no new entries.
    if (state.seq < DISCOVERY_BARS) return [];
    if (state.seq >= FINAL_PHASE_BAR) return [];

    const dip = closes.length > DIP_BARS
      && closes[closes.length - 1] / closes[closes.length - 1 - DIP_BARS] - 1 <= -DIP_BPS / 10000;
    const fallback = !everTraded && state.seq >= FALLBACK_BAR;
    if (dip || fallback) {
      const cash = state.cash;
      if (cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
