import { basicBotDecide } from '../ai/basicBot';
import { shuffledDeck } from '../engine/deck';
import { applyAction, startHand } from '../engine/hand';
import { secureRng } from '../engine/rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState } from '../engine/table';
import type { HandState, PlayerAction } from '../engine/types';
import { getPlayerView } from '../engine/view';

/**
 * Phase 1 test bench: you against five basic bots at a $1/$3 table, with
 * $300 stacks that refill automatically when someone busts.
 */
export const HERO_SEAT = 0;
const STACK = 300;
const NAMES = ['You', 'Bot Ava', 'Bot Ben', 'Bot Cal', 'Bot Dee', 'Bot Eli'];

export class Phase1Game {
  stacks = NAMES.map(() => STACK);
  private buttonState: ButtonState = NEW_BUTTON_STATE;
  handNo = 0;
  hand: HandState | null = null;
  rebuys: string[] = [];

  deal(): HandState {
    this.rebuys = [];
    this.stacks = this.stacks.map((s, i) => {
      if (s > 0) return s;
      this.rebuys.push(NAMES[i]);
      return STACK;
    });
    const plan = planNextHand(
      this.stacks.map((stack, seat) => ({ seat, stack, status: 'active' })),
      NAMES.length,
      this.buttonState,
      secureRng,
    )!;
    this.buttonState = plan.next;
    this.handNo++;
    this.hand = startHand(
      {
        handId: `P1-${this.handNo}`,
        numSeats: NAMES.length,
        smallBlind: 1,
        bigBlind: 3,
        players: plan.dealtIn.map((seat) => ({ seat, id: `seat${seat}`, name: NAMES[seat], stack: this.stacks[seat] })),
        buttonSeat: plan.buttonSeat,
        sbSeat: plan.sbSeat,
        bbSeat: plan.bbSeat,
      },
      shuffledDeck(),
    );
    return this.hand;
  }

  act(action: PlayerAction): HandState {
    const h = this.hand!;
    this.hand = applyAction(h, h.toAct!, action);
    if (this.hand.phase === 'complete') {
      for (const p of this.hand.players) this.stacks[p.seat] = p.stack;
    }
    return this.hand;
  }

  botAction(): PlayerAction {
    const h = this.hand!;
    return basicBotDecide(getPlayerView(h, h.toAct!), secureRng);
  }
}
