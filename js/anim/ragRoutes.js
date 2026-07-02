// ragRoutes.js — deterministic map: catalog topic name → animated tool component.
// Importing registers the custom elements (side effect).

import './suvatAnim.js';
import './vectorLinesAnim.js';

export const TOPIC_ANIM = {
  'Kinematics': {
    tag: 'mb-suvat-anim',
    title: 'Kinematics — constant acceleration',
    defaults: { u: 20, a: -9.8, tMax: 4 },
  },
  'Vectors': {
    tag: 'mb-vector-lines-anim',
    title: 'Vectors — intersection of lines in 3D',
    defaults: { r1: { p: [1, 2, 0], d: [1, 0, 1] }, r2: { p: [0, 1, 2], d: [2, 1, -1] } },
  },
};

export function animForTopic(topic) {
  return TOPIC_ANIM[topic] || null;
}
