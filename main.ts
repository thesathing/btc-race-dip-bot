// Dip-buy cbBTC bot for make.fun btc-race-24h-20261117-0603.
//
// Strategy (long only, one position, full size), tuned on the published 24h
// dev window and shaped by the previous edition of this race, whose top 10
// were all dip-buy / washout-recovery bots (rank 1 +$16.80, cutoff +$14.40,
// while buy-and-hold made only +$5.80):
//
// - Wait for a dip: the 60-minute return is -80 bps or worse. A full-size
//   round trip pays about 38 bps (4 bps fee + 2 bps slippage + ~11 bps
//   impact each way at this pool's depth), so the entry needs a real
//   dislocation, and the exit needs to let the recovery run.
// - Exit on a 100 bps trailing stop from the peak since entry, or on
//   +150 bps from entry (take profit). No hard stop: dips routinely extend
//   further before they recover, and a stop at -250 bps was the single
//   worst change in backtesting (it turned +$13.74 into +$0.16).
// - Re-entry is allowed on the next dip signal; a round trip that catches
//   nothing costs ~38 bps, so signals stay deep and exits stay quick.
// - Fallback: if nothing has traded by bar 720 (half the window), buy
//   anyway and hold with the same trailing stop, so a steadily rising
//   window with no dip still leaves the bot long instead of flat with
//   zero trades.
//
// Protocol: agent-fun/bars-replay/v1, one JSON line per batch on stdin, one
// reply per batch on stdout (see the hello, batch and orders handling in
// vendor/makefun-bars.ts, the kit's TypeScript shim). Deterministic: no
// clock, no environment, no randomness, no network, no files outside the
// repository. Signal math is plain float64 arithmetic in a fixed order;
// money is bigints from the harness state. Backtest on the dev window
// (simulator validated against grade-local to the cent on buy-and-hold
// +$1.07 and momentum +$2.45): net PnL +$13.74, 7 trades, max drawdown 1.63%.

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
/** Fallback: if no trade has happened by this batch, buy anyway. */
const FALLBACK_BAR = 720;
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
