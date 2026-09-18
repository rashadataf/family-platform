import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEUE_TOPOLOGY } from './queue-topology.js';
import { renderElasticmqConfig, RENDERED_CONFIG_PATH } from './render-elasticmq-config.js';

/**
 * Mirrors spec 010 T079's image-tag agreement test: two files that must
 * agree (research.md §4) are read independently and compared, so a
 * hand-edit of the committed `.conf` — or a `QUEUE_TOPOLOGY` change nobody
 * re-rendered from — fails here rather than drifting silently.
 */
describe('render-elasticmq-config (drift check)', () => {
  it('re-rendering QUEUE_TOPOLOGY matches the committed queues.conf byte-for-byte', () => {
    const committed = readFileSync(RENDERED_CONFIG_PATH, 'utf8');
    const rendered = renderElasticmqConfig(QUEUE_TOPOLOGY);
    expect(rendered).toBe(committed);
  });
});
