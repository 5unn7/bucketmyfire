import type { MapModule } from '../types';
import { SASKATCHEWAN } from './region';
import { SASKATCHEWAN as SASKATCHEWAN_TERRAIN } from './terrain';
import { SASKATCHEWAN_MISSIONS } from './missions';
import { card } from './card';

/** Saskatchewan — the live campaign map (world identity + terrain + 8-mission campaign + picker card). */
export const saskatchewan: MapModule = {
  id: 'saskatchewan',
  country: 'canada',
  card,
  region: SASKATCHEWAN,
  terrain: SASKATCHEWAN_TERRAIN,
  missions: SASKATCHEWAN_MISSIONS,
};
