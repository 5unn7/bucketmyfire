/**
 * Back-compat shim. The Huey-only loader generalized into a multi-model registry
 * (see heliModels.ts). `swapInHueyModel(heli)` now just swaps the default hero model
 * (Bell 205A-1) in via the registry; new callers should use `swapInModel(heli, id)`.
 */
import { swapInModel } from './heliModels';
import { HelicopterMesh } from './helicopter';

export function swapInHueyModel(heli: HelicopterMesh): void {
  swapInModel(heli, 'bell-205a1');
}
