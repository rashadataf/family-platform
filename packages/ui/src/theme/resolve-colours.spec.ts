import { describe, expect, it } from 'vitest';
import { colour, type ColourRole } from '../tokens/index.js';
import { resolveColours } from './resolve-colours.js';

describe('resolveColours', () => {
  it('resolves every role to its light value in the light theme', () => {
    const resolved = resolveColours('light');
    for (const role of Object.keys(colour) as ColourRole[]) {
      expect(resolved[role]).toBe(colour[role].light);
    }
  });

  it('resolves every role to its dark value in the dark theme', () => {
    const resolved = resolveColours('dark');
    for (const role of Object.keys(colour) as ColourRole[]) {
      expect(resolved[role]).toBe(colour[role].dark);
    }
  });

  it('resolves every declared role — none silently dropped', () => {
    const resolved = resolveColours('light');
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(colour).sort());
  });
});
