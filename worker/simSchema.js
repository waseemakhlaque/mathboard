// simSchema.js — Worker-side mirror of js/anim/simRegistry.js SIM_REGISTRY.
// Keep in sync manually (no build step). Used by POST /api/sim/resolve (Phase 3).

export const SIM_SCHEMA = [
  {
    tag: 'mb-suvat-lab',
    description: 'SUVAT motion with v-t graph; initial velocity and constant acceleration',
    paramSchema: {
      u: { type: 'number', min: -30, max: 30, default: 20, unit: 'm/s', label: 'Initial velocity u' },
      a: { type: 'number', min: -20, max: 20, default: -9.8, unit: 'm/s²', label: 'Acceleration a' },
    },
  },
  {
    tag: 'mb-motion-graph-lab',
    description: 'Multi-stage or discontinuous velocity-time graph',
    paramSchema: {},
  },
  {
    tag: 'mb-forces-particle-lab',
    description: 'Particle at origin with 2-4 force arrows; equilibrium and Lami',
    paramSchema: {
      nForces: { type: 'number', min: 2, max: 4, default: 3, unit: '', label: 'Number of forces' },
      f1: { type: 'number', min: 0, max: 25, default: 8, unit: 'N', label: 'F₁ magnitude' },
      f2: { type: 'number', min: 0, max: 25, default: 6, unit: 'N', label: 'F₂ magnitude' },
      f3: { type: 'number', min: 0, max: 25, default: 5, unit: 'N', label: 'F₃ magnitude' },
      f4: { type: 'number', min: 0, max: 25, default: 4, unit: 'N', label: 'F₄ magnitude' },
      a1: { type: 'number', min: 0, max: 360, default: 0, unit: '°', label: 'F₁ angle' },
      a2: { type: 'number', min: 0, max: 360, default: 120, unit: '°', label: 'F₂ angle' },
      a3: { type: 'number', min: 0, max: 360, default: 240, unit: '°', label: 'F₃ angle' },
      a4: { type: 'number', min: 0, max: 360, default: 300, unit: '°', label: 'F₄ angle' },
    },
  },
  {
    tag: 'mb-incline-lab',
    description: 'Block on inclined plane with angle and friction coefficient',
    paramSchema: {
      theta: { type: 'number', min: 5, max: 60, default: 25, unit: '°', label: 'Angle θ' },
      mu: { type: 'number', min: 0, max: 1, default: 0.3, unit: '', label: 'Coefficient μ' },
    },
  },
  {
    tag: 'mb-pulley-lab',
    description: 'Atwood machine with two masses over a pulley',
    paramSchema: {
      m1: { type: 'number', min: 1, max: 10, default: 3, unit: 'kg', label: 'Mass m₁' },
      m2: { type: 'number', min: 1, max: 10, default: 5, unit: 'kg', label: 'Mass m₂' },
    },
  },
  { tag: 'mb-connected-lab', description: 'Connected particles tow bar or lift', paramSchema: {} },
  { tag: 'mb-momentum-lab', description: 'Collisions and coalescence', paramSchema: {} },
  { tag: 'mb-energy-lab', description: 'Work, kinetic/potential energy, power', paramSchema: {} },
  {
    tag: 'mb-projectile-lab',
    description: 'Projectile launched at angle; range, max height, time of flight',
    paramSchema: {
      u: { type: 'number', min: 5, max: 50, default: 20, unit: 'm/s', label: 'Launch speed u' },
      theta: { type: 'number', min: 5, max: 85, default: 45, unit: '°', label: 'Launch angle θ' },
      g: { type: 'number', min: 9, max: 10, default: 9.8, unit: 'm/s²', label: 'Gravity g' },
    },
  },
  {
    tag: 'mb-quadratic-lab',
    description: 'Quadratic graph with roots, vertex, discriminant, line intersection',
    paramSchema: {
      a: { type: 'number', min: -3, max: 3, default: 1, unit: '', label: 'Coefficient a' },
      b: { type: 'number', min: -10, max: 10, default: -2, unit: '', label: 'Coefficient b' },
      c: { type: 'number', min: -10, max: 10, default: -3, unit: '', label: 'Coefficient c' },
      lineM: { type: 'number', min: -5, max: 5, default: 1, unit: '', label: 'Line gradient m' },
      lineK: { type: 'number', min: -10, max: 10, default: 0, unit: '', label: 'Line intercept k' },
      showLine: { type: 'number', min: 0, max: 1, default: 1, unit: '', label: 'Show line (0/1)' },
    },
  },
  { tag: 'mb-function-lab', description: 'Graph transformations translate reflect stretch', paramSchema: {} },
  { tag: 'mb-coord-lab', description: 'Lines and circles coordinate geometry', paramSchema: {} },
  { tag: 'mb-trig-lab', description: 'Unit circle linked to sin cos graphs', paramSchema: {} },
  {
    tag: 'mb-tangent-lab',
    description: 'Tangent and normal to a cubic curve; stationary points',
    paramSchema: {
      a: { type: 'number', min: -2, max: 2, default: 1, unit: '', label: 'x³ coeff' },
      b: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'x² coeff' },
      c: { type: 'number', min: -5, max: 5, default: -3, unit: '', label: 'x coeff' },
      d: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'constant' },
      x0: { type: 'number', min: -3, max: 3, default: 1, unit: '', label: 'Point x' },
    },
  },
  { tag: 'mb-area-lab', description: 'Area under curve trapezium rule', paramSchema: {} },
  { tag: 'mb-iteration-lab', description: 'Cobweb iteration x_{n+1}=F(x_n)', paramSchema: {} },
  { tag: 'mb-vector-lines-anim', description: 'Two lines in 3D intersection skew parallel', paramSchema: {} },
  { tag: 'mb-argand-lab', description: 'Complex loci on Argand diagram', paramSchema: {} },
  { tag: 'mb-slopefield-lab', description: 'Differential equation slope field', paramSchema: {} },
];
