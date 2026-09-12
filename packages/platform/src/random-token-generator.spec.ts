import { describe, expect, it } from 'vitest';
import { RandomTokenGenerator } from './random-token-generator.js';

describe('RandomTokenGenerator', () => {
  it('generates a token with 256 bits of entropy', () => {
    const generator = new RandomTokenGenerator();

    const token = generator.generate();

    // base64url of 32 bytes: 43 characters, no padding.
    expect(token).toHaveLength(43);
  });

  it('generates a different token on each call', () => {
    const generator = new RandomTokenGenerator();

    expect(generator.generate()).not.toBe(generator.generate());
  });

  it('hashes deterministically, so a repeated lookup finds the same row', () => {
    const generator = new RandomTokenGenerator();
    const token = generator.generate();

    expect(generator.hash(token)).toBe(generator.hash(token));
  });

  it('hashes two different tokens to two different values', () => {
    const generator = new RandomTokenGenerator();

    expect(generator.hash(generator.generate())).not.toBe(generator.hash(generator.generate()));
  });

  it('never returns the token itself as its own hash', () => {
    const generator = new RandomTokenGenerator();
    const token = generator.generate();

    expect(generator.hash(token)).not.toBe(token);
  });
});
