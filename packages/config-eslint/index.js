// @ts-check
import typescript from './typescript.js';
import boundaries from './boundaries.js';

/**
 * The default configuration every package extends: TypeScript hygiene plus the
 * architectural import zones.
 *
 * The zones are included here rather than opted into per package on purpose.
 * Their policies target `packages/core`'s contexts, which do not exist yet, so
 * they are inert today and become active the moment the first context lands —
 * which is the whole point of establishing them now instead of retrofitting
 * them onto code already written against no rules.
 */
export default [...typescript, ...boundaries];
