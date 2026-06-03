// Central tuning knobs. Top-down realistic view: the world is a flat plane in
// pixels, the camera follows the helicopter, and Arcade Physics keeps it cheap
// enough to hold 60fps on mobile browsers.

export const GAME = {
  width: 960,
  height: 540,
  backgroundColor: '#0e160f',
};

export const WORLD = {
  width: 3200,
  height: 3200,
};

// Helicopter flight model. Tuned for momentum / inertia so the aircraft drifts
// and banks like the real thing rather than snapping to a stop.
export const HELI = {
  enginePower: 900, // force applied in the input direction
  mass: 1.0,
  linearDrag: 1.6, // air resistance: higher = settles faster
  maxSpeed: 360,
  rotorSpinSpeed: 28, // visual rotor blur rotation (rad/s)
  yawLerp: 0.12, // how quickly the nose swings toward travel direction
  maxBank: 0.5, // radians of visual roll at full lateral accel
  // Altitude is faked with a drop-shadow offset + sprite scale so the heli reads
  // as airborne in the top-down view. Descend to scoop, climb to cruise.
  cruiseAltitude: 90,
  scoopAltitude: 26,
  altitudeLerp: 0.08,
  shadowSpread: 0.35, // shadow gap per unit altitude
  scalePerAltitude: 0.0011, // sprite grows slightly with altitude
};

// Bambi bucket slung under the helicopter.
export const BUCKET = {
  capacity: 100,
  refillRate: 70, // litres/sec while dipped in a lake
  dropRate: 220, // litres/sec while releasing
  dropRadius: 70, // world-units the dropped water covers
};

export const FIRE = {
  count: 7,
  maxIntensity: 100,
  regrowth: 3.5, // intensity/sec when not being doused
  spreadIntervalMs: 9000, // slower cadence — fires creep, they don't erupt
  spreadChance: 0.15, // per active fire, per tick
  spreadDistance: 130,
  maxActive: 22, // hard cap so spread can't run away exponentially
  douseRate: 90, // intensity/sec removed by a water drop
};

export const LAKES = [
  { x: 700, y: 900, r: 240 },
  { x: 2300, y: 700, r: 200 },
  { x: 1500, y: 2400, r: 300 },
  { x: 2600, y: 2500, r: 180 },
];

export const COLORS = {
  forest: 0x2f4a2c,
  forestDark: 0x263d24,
  grid: 0x000000,
  water: 0x2f7d96,
  waterDeep: 0x255f73,
  shadow: 0x000000,
};
