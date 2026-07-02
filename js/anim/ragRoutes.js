// ragRoutes.js — deterministic map: catalog topic name → animated/interactive tool.
// Importing registers the custom elements (side effect).

import './suvatAnim.js';
import './vectorLinesAnim.js';
import './inclineLab.js';
import './pulleyLab.js';
import './suvatLab.js';

export const LABS = [
  { tag: 'mb-incline-lab', title: 'Inclined plane — forces & friction', icon: '📐' },
  { tag: 'mb-pulley-lab', title: 'Pulley (Atwood machine)', icon: '⚙️' },
  { tag: 'mb-suvat-lab', title: 'SUVAT — motion & v–t graph', icon: '🚀' },
];

export const TOPIC_ANIM = {
  'Kinematics': { tag: 'mb-suvat-lab', title: 'SUVAT — motion & v–t graph' },
  'Motion on a slope': { tag: 'mb-incline-lab', title: 'Inclined plane — forces & friction' },
  'Forces & equilibrium': { tag: 'mb-incline-lab', title: 'Inclined plane — forces & friction' },
  "Newton's laws": { tag: 'mb-pulley-lab', title: 'Pulley (Atwood machine)' },
  'Work, energy & power': { tag: 'mb-incline-lab', title: 'Inclined plane — forces & friction' },
  'Vectors': {
    tag: 'mb-vector-lines-anim',
    title: 'Vectors — intersection of lines in 3D',
    defaults: { r1: { p: [1, 2, 0], d: [1, 0, 1] }, r2: { p: [0, 1, 2], d: [2, 1, -1] } },
  },
};

export function animForTopic(topic) {
  return TOPIC_ANIM[topic] || null;
}
