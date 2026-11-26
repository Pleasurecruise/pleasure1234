import { byId } from '../../lib/dom';
import { mountBubbles } from './bubbles';
import { mountCord } from './cord';
import { mountDial } from './dial';
import { mountPassword } from './password';
import { mountTape } from './tape';

export function mountTactile() {
  mountCord(byId('t-cord', HTMLElement));
  mountPassword(byId('t-password', HTMLElement));
  mountBubbles(byId('t-bubbles', HTMLElement));
  mountDial(byId('t-dial', HTMLElement));
  mountTape(byId('t-tape', HTMLElement));
}
