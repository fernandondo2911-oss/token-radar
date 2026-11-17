# Token Radar
[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fernandondo2911-oss/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fernandondo2911-oss/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks,
works out which ones still record no token, ranks them by what a launch would be worth
under a peer-calibrated value model, and hands in a web dashboard with the board, a
detail view for every protocol, and the steps to farm each one.

## The model

The implied value is this entry's own claim, computed only from the snapshot's figures
(`lib/model.ts`, function `impliedValue`):

- **Peer multiple** — the median market-cap-to-TVL ratio of the token-having protocols in
  the same category, shrunk toward the all-category median when peers are few, so a
  category with one loud peer cannot set the price on its own.
- **Growth** — `1 + clamp(change_7d, -50, 150) / 100 * 0.5`.
- **Maturity** — `0.7 + 0.3 * min(age_days, 730) / 730` (an unknown listing date counts as
  365 days).
- **Implied value** — `TVL x peer multiple x growth x maturity`, rounded to whole dollars.

The board ranks every protocol whose record carries no token and which is not a wrapped,
staked or bridged product of a token that already trades: the snapshot's 40-protocol
watchlist plus every other rankable pre-token protocol below the floor. Protocols whose
token already trades are kept apart in a Live token view with the market's own values.
The dashboard's `app.js` carries the same arithmetic (`impliedOf`, `calibratePeers`,
`farmSteps`), so the page recomputes every number it shows, and a model sandbox lets the
reader change the constants and watch the board re-rank live.

The snapshot's record is not proof: the dashboard says a protocol *records no token*,
never that it has none, and the implied value is a model, not a promise and not a
prediction that a token will be issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json` (the ranked board),
`data.js` (the dashboard's data), and copies `dashboard/` and `screenshots/` into the
output directory, then writes `dossier.json` with the vendored make.fun library. Open
`out/dashboard/index.html` in a browser; the page renders with no network.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the value model, the board builder and the farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit byte for byte.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — three captures of the dashboard: the board, a protocol's detail view,
  and a filtered view.

## Screenshots

The three screenshots in `screenshots/` are captures of this dashboard running on the
sealed snapshot, taken with a headless browser at 1440x900: the board, the detail view
of the top-ranked protocol, and a filtered view.
