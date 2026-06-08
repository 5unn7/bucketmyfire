import type { MapModule } from '../types';
import { SASKATCHEWAN } from './region';
import { SASKATCHEWAN as SASKATCHEWAN_TERRAIN } from './terrain';
import { card } from './card';

/** Saskatchewan — the live world (world identity + terrain + picker card). The 8-mission linear
 *  campaign was retired in the Living Province cutover: the province IS the game now (pick it, fly,
 *  hold the towns over a bounded shift). Teaching folded into the province onboarding arc. The map
 *  carries no `missions`, so `allMissions()`/`CAMPAIGN` resolve empty — by design. */
export const saskatchewan: MapModule = {
  id: 'saskatchewan',
  country: 'canada',
  card,
  region: SASKATCHEWAN,
  terrain: SASKATCHEWAN_TERRAIN,
};
