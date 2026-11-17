# btc-race-dip-bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/thesathing/btc-race-dip-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/thesathing/btc-race-dip-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A dip-buy trading bot for Coinbase Wrapped BTC (cbBTC) on Solana, entered in make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades 1-minute on-chain bars with $1,000 of paper money: it waits for a real dip (60-minute return at or below -80 bps), buys full size, and exits on a 100 bps trailing stop or +150 bps take profit, with a fallback buy halfway through the window so a steadily rising market still leaves it long.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's TypeScript shim, copied byte-identical). It needs no install step and no network: standard library plus the vendored shim only. Node 22 runs it with type stripping (`node main.ts`).

Local dev-window grade (kit's `grade-local`, process driver): net PnL **+$13.74**, 7 trades, max drawdown 1.63%.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wftbn3z4&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
