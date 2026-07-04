// simRegistry.js — single source of truth for Snip-to-Sim archetypes.
// Side-effect imports register every lab custom element.
// Keep worker/simSchema.js in sync (same tags + paramSchema).

import './inclineLab.js';
import './pulleyLab.js';
import './suvatLab.js';
import './forcesParticleLab.js';
import './projectileLab.js';
import './quadraticLab.js';
import './tangentLab.js';
import './vectorLinesAnim.js';

/** @typedef {{ type:'number', min:number, max:number, default:number, unit:string, label:string }} ParamSpec */
/** @typedef {{ tag:string, title:string, icon:string, group:'M1'|'P1'|'P3', built:boolean, topics:string[], paramSchema:Record<string,ParamSpec> }} SimEntry */

export const SIM_REGISTRY = /** @type {SimEntry[]} */ ([
  {
    tag: 'mb-suvat-lab',
    title: 'SUVAT — motion & v–t graph',
    icon: '🚀',
    group: 'M1',
    built: true,
    topics: ['Kinematics'],
    paramSchema: {
      u: { type: 'number', min: -30, max: 30, default: 20, unit: 'm/s', label: 'Initial velocity u' },
      a: { type: 'number', min: -20, max: 20, default: -9.8, unit: 'm/s²', label: 'Acceleration a' },
    },
  },
  {
    tag: 'mb-motion-graph-lab',
    title: 'Multi-stage v–t graph',
    icon: '📈',
    group: 'M1',
    built: false,
    topics: ['Kinematics'],
    paramSchema: {},
  },
  {
    tag: 'mb-forces-particle-lab',
    title: 'Forces on a particle — equilibrium',
    icon: '⚖️',
    group: 'M1',
    built: true,
    topics: ['Forces & equilibrium'],
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
    title: 'Inclined plane — forces & friction',
    icon: '📐',
    group: 'M1',
    built: true,
    topics: ['Motion on a slope', 'Forces & equilibrium', 'Work, energy & power'],
    paramSchema: {
      theta: { type: 'number', min: 5, max: 60, default: 25, unit: '°', label: 'Angle θ' },
      mu: { type: 'number', min: 0, max: 1, default: 0.3, unit: '', label: 'Coefficient μ' },
    },
  },
  {
    tag: 'mb-pulley-lab',
    title: 'Pulley (Atwood machine)',
    icon: '⚙️',
    group: 'M1',
    built: true,
    topics: ["Newton's laws"],
    paramSchema: {
      m1: { type: 'number', min: 1, max: 10, default: 3, unit: 'kg', label: 'Mass m₁' },
      m2: { type: 'number', min: 1, max: 10, default: 5, unit: 'kg', label: 'Mass m₂' },
    },
  },
  {
    tag: 'mb-connected-lab',
    title: 'Connected particles — tow bar / lift',
    icon: '🔗',
    group: 'M1',
    built: false,
    topics: ["Newton's laws"],
    paramSchema: {},
  },
  {
    tag: 'mb-momentum-lab',
    title: 'Collisions & momentum',
    icon: '💥',
    group: 'M1',
    built: false,
    topics: ['Momentum'],
    paramSchema: {},
  },
  {
    tag: 'mb-energy-lab',
    title: 'Work, KE, PE & power',
    icon: '⚡',
    group: 'M1',
    built: false,
    topics: ['Work, energy & power'],
    paramSchema: {},
  },
  {
    tag: 'mb-projectile-lab',
    title: 'Projectile motion',
    icon: '🎯',
    group: 'M1',
    built: true,
    topics: ['Projectiles'],
    paramSchema: {
      u: { type: 'number', min: 5, max: 50, default: 20, unit: 'm/s', label: 'Launch speed u' },
      theta: { type: 'number', min: 5, max: 85, default: 45, unit: '°', label: 'Launch angle θ' },
      g: { type: 'number', min: 9, max: 10, default: 9.8, unit: 'm/s²', label: 'Gravity g' },
    },
  },
  {
    tag: 'mb-quadratic-lab',
    title: 'Quadratic — roots, vertex & line',
    icon: '⌒',
    group: 'P1',
    built: true,
    topics: ['Algebra'],
    paramSchema: {
      a: { type: 'number', min: -3, max: 3, default: 1, unit: '', label: 'Coefficient a' },
      b: { type: 'number', min: -10, max: 10, default: -2, unit: '', label: 'Coefficient b' },
      c: { type: 'number', min: -10, max: 10, default: -3, unit: '', label: 'Coefficient c' },
      lineM: { type: 'number', min: -5, max: 5, default: 1, unit: '', label: 'Line gradient m' },
      lineK: { type: 'number', min: -10, max: 10, default: 0, unit: '', label: 'Line intercept k' },
      showLine: { type: 'number', min: 0, max: 1, default: 1, unit: '', label: 'Show line (0/1)' },
    },
  },
  {
    tag: 'mb-function-lab',
    title: 'Graph transformations',
    icon: '↔️',
    group: 'P1',
    built: false,
    topics: ['Algebra'],
    paramSchema: {},
  },
  {
    tag: 'mb-coord-lab',
    title: 'Coordinate geometry — line & circle',
    icon: '○',
    group: 'P1',
    built: false,
    topics: ['Algebra'],
    paramSchema: {},
  },
  {
    tag: 'mb-trig-lab',
    title: 'Trigonometry — unit circle & graphs',
    icon: '🌊',
    group: 'P1',
    built: false,
    topics: ['Trigonometry'],
    paramSchema: {},
  },
  {
    tag: 'mb-tangent-lab',
    title: 'Tangent & normal to a curve',
    icon: '📏',
    group: 'P1',
    built: true,
    topics: ['Differentiation'],
    paramSchema: {
      a: { type: 'number', min: -2, max: 2, default: 1, unit: '', label: 'x³ coeff' },
      b: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'x² coeff' },
      c: { type: 'number', min: -5, max: 5, default: -3, unit: '', label: 'x coeff' },
      d: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'constant' },
      x0: { type: 'number', min: -3, max: 3, default: 1, unit: '', label: 'Point x' },
    },
  },
  {
    tag: 'mb-area-lab',
    title: 'Integration — area under a curve',
    icon: '∫',
    group: 'P1',
    built: false,
    topics: ['Integration'],
    paramSchema: {},
  },
  {
    tag: 'mb-iteration-lab',
    title: 'Numerical iteration — cobweb',
    icon: '🔄',
    group: 'P3',
    built: false,
    topics: ['Numerical solution of equations'],
    paramSchema: {},
  },
  {
    tag: 'mb-vector-lines-anim',
    title: 'Vectors — intersection of lines in 3D',
    icon: '📐',
    group: 'P3',
    built: true,
    topics: ['Vectors'],
    paramSchema: {},
  },
  {
    tag: 'mb-argand-lab',
    title: 'Argand diagram — loci',
    icon: 'ℂ',
    group: 'P3',
    built: false,
    topics: ['Complex numbers'],
    paramSchema: {},
  },
  {
    tag: 'mb-slopefield-lab',
    title: 'Differential equations — slope field',
    icon: '∿',
    group: 'P3',
    built: false,
    topics: ['Differential equations'],
    paramSchema: {},
  },
]);

/** Built labs shown in the Physics Labs picker, grouped M1 / P1 / P3. */
export const LABS = SIM_REGISTRY.filter((e) => e.built && e.tag.endsWith('-lab'));

/** Default param values from a registry entry's paramSchema. */
export function defaultParams(entry) {
  const out = {};
  for (const [k, spec] of Object.entries(entry.paramSchema || {})) out[k] = spec.default;
  return out;
}

/** Map catalog topic name → primary sim route (first matching built entry). */
export const TOPIC_ANIM = (() => {
  const map = {};
  for (const e of SIM_REGISTRY) {
    if (!e.built) continue;
    for (const topic of e.topics) {
      if (map[topic]) continue;
      map[topic] = {
        tag: e.tag,
        title: e.title,
        defaults: Object.keys(e.paramSchema || {}).length ? defaultParams(e) : undefined,
      };
    }
  }
  // vector anim needs structured defaults
  map.Vectors = {
    tag: 'mb-vector-lines-anim',
    title: 'Vectors — intersection of lines in 3D',
    defaults: { r1: { p: [1, 2, 0], d: [1, 0, 1] }, r2: { p: [0, 1, 2], d: [2, 1, -1] } },
  };
  return map;
})();

export function animForTopic(topic) {
  return TOPIC_ANIM[topic] || null;
}

export function simByTag(tag) {
  return SIM_REGISTRY.find((e) => e.tag === tag) || null;
}
