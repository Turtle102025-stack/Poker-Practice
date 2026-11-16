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
| 3 | 50 player personalities, seating, tilt | ✅ Done |
| 4 | Lobby, bankroll, buy-ins, saving progress | ✅ Done |
| 5 | Hand history storage and export (.xlsx, CSV, PokerStars text) | ✅ Done |
| 6 | Notes, stats page, practice mode, polish | ✅ Done |

## Lobby and bankroll

- You start with **$2,000**. Five tables: $1/$3 ($100–$500), $2/$5 ($200–$500),
  $5/$10 ($400–$1,500), $10/$20 ($800, no max) and $50/$100 ($5,000, no max).
  Tables you can't afford are shown but locked.
- Pick an open seat and buy in; the buy-in comes out of your bankroll. Joining a game
  in progress, you either post a big blind to come in or wait for the big blind.
- Between hands you can add chips up to the table maximum (or up to your bankroll at
  no-max tables). If you bust, the game waits while you rebuy (at least the minimum) or leave.
- Leaving puts your stack back in your bankroll. If you can't afford any table and have
  no chips in play, you're offered a fresh $2,000.
- Rake is off by default; turn it on in the lobby (percent, cap per table, no flop no drop).
- Everything is saved in your browser (IndexedDB) after every action. Close the page
  mid-hand and you'll come back to the same hand with the same cards to come.

## Notes, reads and stats

- **Click any player** at the table to see what you'd notice about them, tag them with a
  label (Nit, Semi-nit, Tight Passive, Loose Passive Rec, Loose Aggressive Rec, Overly
  Aggressive Reg, Good Reg, Short Stacker, Unknown) and write notes. Your label shows on
  their seat. Notes are saved and kept between sessions.
- The panel shows what you've observed **this session and all time**: hands, VPIP, PFR,
  limp, 3-bet, c-bet, fold to c-bet, showdown and aggression.
- **👥 Players & reads** (lobby) lists everyone you've played with. **🔍 Reveal styles**
  shows each player's true style and scores your reads.
- **📈 Stats**: bankroll over time (hover or use the arrow keys for values), result since
  you started, hands played, your VPIP and PFR, results by table and by position, and
  every session.
- **Practice mode** (on by default) shows everyone's hole cards after each hand.
- **💾 Backup** (lobby) downloads everything as one file; restoring it brings your
  bankroll, hands, notes and stats into any browser.

## Hand histories and export

Every hand you're dealt into is saved. Open **📜 Hand history** (lobby or table) to:

- Pick a range: this/last session, today, last 7 days, all hands, or dates.
- **Download .xlsx** with three sheets plus a Notes sheet:
  - **Hands** – hand ID, date/time, table, stakes, players, button seat, your seat and
    position, your cards and starting stack, flop/turn/river, final pot, rake, winner(s)
    and winning hand, your net ($ and BB), showdown, straddle.
  - **Actions** – every post, fold, check, call, bet, raise and all-in: amount added,
    street total ("raise to"), amount faced, pot before/after, bet as % of pot, stack
    before/after, effective stack, board, and whether it was you. Uncalled bets returned
    are listed too.
  - **Players** – one row per player per hand: seat, position, starting stack, hole cards
    (when shown, always yours, everyone's in practice mode), net result, your label
    for them, and optionally their true style.
- **Download CSV** (the same three sheets as three files) or **text** (all hands in
  PokerStars format).
- Open any hand and **Copy hand history** to paste it into a chat; the table also has a
  copy button after each hand.

Bet % of pot: a bet ÷ the pot before it; a raise's extra amount ÷ the pot after calling
(so a pot-sized raise is 100%).

## Playing

- **Fold / Check-Call / Bet-Raise.** Size bets with the quick buttons (Min, ⅓, ½, ⅔ pot,
  Pot, All-in), the slider, or by typing an amount. If an amount isn't legal, it's
  adjusted and the reason is shown (e.g. "Minimum raise is to $67"); click again to confirm.
- **Keyboard:** `F` fold, `C` check/call, `R` bet/raise, `Space` deal the next hand.
- **Settings (⚙):** computer player speed, when to deal the next hand, fast-forward after
  folding, practice mode (show all hole cards after each hand), straddle when under the
  gun, four-color deck, show your current hand.
- **Pause** stops the computer players; **Fast-forward** finishes a hand you're out of.

## The computer players

50 players, each with a name, what you'd notice about them at the table, a buy-in
habit, how long they usually stay, and a hidden style:

| Style | Count | Measured VPIP / PFR |
|---|---|---|
| Nit | 6 | ~9% / 7% |
| Semi-nit | 6 | ~14% / 10% |
| Tight passive | 6 | ~17% / 3.5% |
| Loose passive rec | 9 | ~43% / 4% |
| Loose aggressive rec | 7 | ~50% / 22% |
| Overly aggressive reg | 5 | ~25% / 22% (3-bets ~12%) |
| Good reg | 5 | ~21% / 18% |
| Short stacker | 6 | ~14% / 12% (mostly all-in or fold) |

- Each style is a set of parameters (preflop ranges by position, limping, 3-betting,
  live-style bet sizes, c-bet and barrel frequencies, calling thresholds, stickiness,
  bluffing, slowplaying, folding to scare cards, tilt sensitivity); each player varies
  around their style, and decisions include randomness.
- **Tilt:** after losing a big pot, players loosen up and bluff more for a while,
  scaled by how tilt-prone they are, and you may see them react at the table.
- **Good regulars** keep the same public stats you could (VPIP, PFR, fold to c-bet…)
  and adjust: isolating limpers, value-betting thinner against callers, bluffing them less.
- **No peeking:** computer players only receive their own view of the hand (their cards,
  the board, the betting, stacks). A test checks that changing opponents' hidden cards
  never changes a decision.
- **Seating:** you sit with 6–9 others drawn from the pool, weighted by the stakes each
  player likes (lots of recreational players and short stackers at $1/$3 and $2/$5, more
  regulars higher up). Players rebuy, top up, cash out, and new ones arrive and wait for
  the big blind or post to come in.
- `npm run calibrate` plays tens of thousands of hands between the computer players and
  prints each style's measured stats and win rate; a smaller run is part of the tests.

## How it's checked

Every push to `main` runs on GitHub Actions (see the **Actions** tab):

1. Type check
2. Unit tests (betting rules, side pots, splits and odd chips, straddles,
   dead button, hand evaluator edge cases, shuffle fairness, AI information firewall)
3. A 50,000-hand rules simulation with random stacks, random legal and illegal
   actions, and players coming and going; every showdown is re-checked with a
   second, independent hand evaluator
4. A 30,000-hand run of the computer players, printing each style's measured stats
5. Build, then an end-to-end test in a real browser: buy in, play 200 hands (with a
   refresh mid-hand and deliberately illegal bet sizes), leave, check the bankroll,
   export the spreadsheet and check that every hand's bets add up to its pot
6. Publish to GitHub Pages

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
npm run calibrate -- 50000   # measure the computer players' styles
npm run play       # play in the terminal
npm run build      # production build into dist/
npm run e2e        # end-to-end test (after build); SOAK_HANDS=500 npm run e2e for a longer run
```

Code layout:

- `src/engine/` pure poker engine (no UI): cards, RNG, evaluator, betting, pots,
  button movement, player view (the only data computer players receive)
- `src/ai/` computer players
- `src/table/` table controller: the game loop between the engine, the computer players and the UI
- `src/app/` your bankroll, sessions, notes and stats (the game store)
- `src/history/` hand records, PokerStars text, spreadsheet/CSV export
- `src/storage/` IndexedDB (Dexie), hand queries, backup/restore
- `src/ui/` React user interface
- `e2e/` end-to-end test that plays through the real page
- `scripts/` command-line tools
