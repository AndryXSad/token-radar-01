# Token Radar — pre-token protocols ranked by fitted implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AndryXSad/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AndryXSad/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry. It reads the sealed DefiLlama snapshot
(`input/snapshot.json`), fits a comparables model from the snapshot's own
live-token protocols, and hands in a web dashboard with the ranked board, a
detail view per protocol, and the steps to farm each one.

## The model (`lib/model.ts`, `radar-2-comps`)

- **Comparables fit, at runtime.** Log market cap on log TVL over the 128
  protocols that record a token with a market cap above zero (pooled slope
  ≈ 0.52, log-space R² ≈ 0.32 with category shifts), then one intercept
  shift per category from its median residual, shrunk by n/(n+4) toward the
  pooled line. No multiple is typed in by hand; no protocol name is ever
  special-cased.
- **Growth and age.** The fitted value is multiplied by 1 + 0.35 × clamped
  7-day TVL change (−40% to +80%) and by a maturity factor from 0.70 to 1.00
  over three years of tracking, then capped at 5× TVL.
- **Honest error.** A five-fold split by slug gives a median out-of-sample
  error of about ×3.6. Implied values are order-of-magnitude claims, and the
  dashboard says so.
- **Coverage.** All 40 watchlist protocols plus every other strictly
  pre-token protocol in the snapshot — 198 rows. A protocol is pre-token
  when its market cap, CoinGecko id and symbol are all null, and not a
  wrapped, staked or bridged product of a token that already trades.
- **Farm plans.** Seven steps per protocol, derived from its category,
  chains, TVL and age, each with a cost and a time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to `out/`. Node 22, standard library only; no network.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the fitted model, the farm plans, the snapshot parser.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with
  no network from `data.js`; recomputes each row's implied value so the
  page's code and the board's data visibly agree.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
