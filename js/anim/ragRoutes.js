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
