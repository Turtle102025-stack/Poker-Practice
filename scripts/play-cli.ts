/**
 * Play hands in the terminal against basic bots:  npm run play
 * Commands: f = fold, x = check, c = call, a = all-in, r 45 / b 45 = raise or bet to $45, q = quit.
 */
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { cardsToString } from '../src/engine/cards';
import { legalActions } from '../src/engine/hand';
import type { PlayerAction } from '../src/engine/types';
import { eventLines } from '../src/ui/logText';
import { HERO_SEAT, Phase1Game } from '../src/ui/phase1Game';

const rl = readline.createInterface({ input: stdin, output: stdout });
const game = new Phase1Game();

function parse(ans: string): PlayerAction | null {
  if (ans === 'f') return { type: 'fold' };
  if (ans === 'x') return { type: 'check' };
  if (ans === 'c') return { type: 'call' };
  if (ans === 'a') return { type: 'allin' };
  const m = /^([rb])\s*(\d+)$/.exec(ans);
  return m ? { type: m[1] === 'b' ? 'bet' : 'raise', to: Number(m[2]) } : null;
}

async function main() {
  for (;;) {
    let hand = game.deal();
    let printed = 0;
    const flush = () => {
      const lines = eventLines(hand, HERO_SEAT);
      for (const l of lines.slice(printed)) console.log(l);
      printed = lines.length;
    };
    const me = hand.players.find((p) => p.seat === HERO_SEAT)!;
    console.log(`\n=== Hand #${game.handNo}: you are ${me.position} with [${cardsToString(me.hole)}], stack $${me.startStack} ===`);
    while (hand.phase !== 'complete') {
      flush();
      if (hand.toAct !== HERO_SEAT) {
        hand = game.act(game.botAction());
        continue;
      }
      const legal = legalActions(hand)!;
      const opts = [
        'f',
        legal.canCheck ? 'x' : `c (${legal.callAmount})`,
        legal.canRaise ? `${legal.isBet ? 'b' : 'r'} ${legal.minTo}-${legal.maxTo}` : '',
        'a',
      ].filter(Boolean);
      const board = hand.board.length ? ` board [${cardsToString(hand.board)}]` : '';
      const ans = (await rl.question(`[${cardsToString(me.hole)}]${board}  ${opts.join(' | ')} > `)).trim().toLowerCase();
      if (ans === 'q') return rl.close();
      const action = parse(ans);
      if (!action) {
        console.log('Unknown command');
        continue;
      }
      try {
        hand = game.act(action);
      } catch (e) {
        console.log(`Not allowed: ${(e as Error).message}`);
      }
    }
    flush();
    console.log(`Your result: ${hand.result!.net[HERO_SEAT] ?? 0}. Stacks: ${game.stacks.map((s) => `$${s}`).join(' ')}`);
    const again = (await rl.question('Next hand? (enter = yes, q = quit) ')).trim().toLowerCase();
    if (again === 'q') return rl.close();
  }
}

main();
