# Poker Practice

A browser-based No-Limit Texas Hold'em practice game. Play against computer
opponents with realistic live-poker styles, then export your hand histories
for review. Everything runs in your browser: no server, no accounts, no real money.

**Play it:** https://turtle102025-stack.github.io/Poker-Practice/

## Status

| Phase | What | Status |
|---|---|---|
| 1 | Poker engine, hand evaluator, tests | ✅ Done |
| 2 | Table UI with simple bots | ✅ Done |
| 3 | 50 player personalities, seating, tilt | Next |
| 4 | Lobby, bankroll, buy-ins, saving progress | |
| 5 | Hand history storage and export (.xlsx, CSV, PokerStars text) | |
| 6 | Notes, stats page, practice mode, polish | |

## Playing

- **Fold / Check-Call / Bet-Raise.** Size bets with the quick buttons (Min, ⅓, ½, ⅔ pot,
  Pot, All-in), the slider, or by typing an amount. If an amount isn't legal, it's
  adjusted and the reason is shown (e.g. "Minimum raise is to $67"); click again to confirm.
- **Keyboard:** `F` fold, `C` check/call, `R` bet/raise, `Space` deal the next hand.
- **Settings (⚙):** computer player speed, when to deal the next hand, fast-forward after
  folding, practice mode (show all hole cards after each hand), straddle when under the
  gun, four-color deck, show your current hand.
- **Pause** stops the computer players; **Fast-forward** finishes a hand you're out of.

## How it's checked

Every push to `main` runs on GitHub Actions (see the **Actions** tab):

1. Type check
2. Unit tests (betting rules, side pots, splits and odd chips, straddles,
   dead button, hand evaluator edge cases, shuffle fairness, AI information firewall)
3. A 50,000-hand rules simulation with random stacks, random legal and illegal
   actions, and players coming and going; every showdown is re-checked with a
   second, independent hand evaluator
4. Build, then publish to GitHub Pages

If any step fails, the site is not updated.

## Rules implemented

- Min bet = big blind; min raise = size of the last full bet or raise.
- An all-in for less than a full raise does not reopen betting for players who
  already acted, unless several short all-ins add up to a full raise (Robert's Rules).
- Short all-in blinds (others must still call the full blind), big blind option,
  uncalled bets returned, heads-up blind order.
- Side pots from any number of all-ins; split pots with the odd chip to the first
  winner left of the button.
- Showdown order: last aggressor shows first, otherwise first player left of the
  button; beaten hands may muck. All hands are shown on an all-in run-out.
- Dead-button rule. New players wait for the big blind or post a live big blind
  (not allowed between the button and the big blind).
- Optional UTG straddle (2 big blinds): action starts left of the straddler, who
  acts last preflop with the option.
- Optional rake (% with a cap, no flop no drop). Off by default.
- Shuffle: `crypto.getRandomValues` with rejection sampling + Fisher–Yates.

## For developers

Requires Node 22+.

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run sim -- 100000   # rules simulation
npm run play       # play in the terminal
npm run build      # production build into dist/
```

Code layout:

- `src/engine/` pure poker engine (no UI): cards, RNG, evaluator, betting, pots,
  button movement, player view (the only data computer players receive)
- `src/ai/` computer players
- `src/table/` table controller: the game loop between the engine, the computer players and the UI
- `src/ui/` React user interface
- `scripts/` command-line tools
