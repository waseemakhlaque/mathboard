// ragRoutes.js — re-exports sim registry (side-effect: suvat timeline anim still registers here).

import './suvatAnim.js';
export {
  SIM_REGISTRY,
  LABS,
  TOPIC_ANIM,
  animForTopic,
  defaultParams,
  simByTag,
} from './simRegistry.js';

/** Map coursebook section heading / topic text → lab custom-element tag. */
const SECTION_LAB_RULES = [
  { re: /friction|inclin|slope|angle of friction|motion on a slope/i, tag: 'mb-incline-lab' },
  { re: /connected particle|tow bar|towing|light (?:inextensible )?string|lift.*particle/i, tag: 'mb-connected-lab' },
  { re: /pulley|atwood/i, tag: 'mb-pulley-lab' },
  { re: /projectile|trajectory|range of projection/i, tag: 'mb-projectile-lab' },
  { re: /suvat|kinematic|constant acceleration|equations of motion/i, tag: 'mb-suvat-lab' },
  { re: /momentum|collision|impulse|coalesce/i, tag: 'mb-momentum-lab' },
  { re: /work.*power|kinetic energy|potential energy|conservation of energy/i, tag: 'mb-energy-lab' },
  { re: /force.*equilibrium|equilibrium.*force|resolving force|resultant force/i, tag: 'mb-forces-particle-lab' },
  { re: /v.?t graph|motion graph|velocity.?time|speed.?time/i, tag: 'mb-motion-graph-lab' },
  { re: /quadratic|parabola|discriminant/i, tag: 'mb-quadratic-lab' },
  { re: /tangent|normal.*curve|differentiation|gradient function/i, tag: 'mb-tangent-lab' },
  { re: /vector.*3d|intersection.*line|skew|parallel lines/i, tag: 'mb-vector-lines-anim' },
];

export function detectLabFromSection(sectionText) {
  const t = String(sectionText || '').trim();
  if (!t) return null;
  for (const { re, tag } of SECTION_LAB_RULES) {
    if (re.test(t)) return tag;
  }
  return null;
}
