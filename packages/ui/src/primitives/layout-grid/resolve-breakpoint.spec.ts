import { describe, expect, it } from 'vitest';
import { resolveBreakpointKey } from './resolve-breakpoint.js';

describe('resolveBreakpointKey', () => {
  it('resolves a phone width to sm', () => {
    expect(resolveBreakpointKey(0)).toBe('sm');
    expect(resolveBreakpointKey(390)).toBe('sm');
    expect(resolveBreakpointKey(599)).toBe('sm');
  });

  it('resolves a tablet width to md', () => {
    expect(resolveBreakpointKey(600)).toBe('md');
    expect(resolveBreakpointKey(1023)).toBe('md');
  });

  it('resolves a laptop width to lg', () => {
    expect(resolveBreakpointKey(1024)).toBe('lg');
    expect(resolveBreakpointKey(1439)).toBe('lg');
  });

  it('resolves a desktop width to xl, unbounded above', () => {
    expect(resolveBreakpointKey(1440)).toBe('xl');
    expect(resolveBreakpointKey(4000)).toBe('xl');
  });

  it('falls back to sm for a width below zero, which cannot occur from a real window', () => {
    expect(resolveBreakpointKey(-1)).toBe('sm');
  });
});
