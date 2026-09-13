import { describe, expect, it } from 'vitest';
import { elevation } from '../tokens/index.js';
import { elevationToShadowStyle } from './elevation-style.js';

describe('elevationToShadowStyle', () => {
  it('resolves level 0 ("none") to no shadow properties at all, not zeroed ones', () => {
    const style = elevationToShadowStyle('0', elevation['0']);
    expect(style.shadowOpacity).toBeUndefined();
    expect(style.shadowColor).toBeUndefined();
    expect(style.elevation).toBe(0);
  });

  it('parses offset, blur and colour out of a real elevation token', () => {
    // '1': '0 1px 2px rgba(31,27,22,0.06)'
    const style = elevationToShadowStyle('1', elevation['1']);
    expect(style.shadowOffset).toEqual({ width: 0, height: 1 });
    expect(style.shadowRadius).toBe(2);
    expect(style.shadowOpacity).toBeCloseTo(0.06, 5);
    expect(style.shadowColor).toBe('#1F1B16');
  });

  it('gives every non-zero level a distinct, increasing Android elevation', () => {
    const level1 = elevationToShadowStyle('1', elevation['1']).elevation;
    const level2 = elevationToShadowStyle('2', elevation['2']).elevation;
    const level3 = elevationToShadowStyle('3', elevation['3']).elevation;
    expect(level1).toBeLessThan(level2);
    expect(level2).toBeLessThan(level3);
  });

  it('throws rather than silently misreading an unparseable shadow string', () => {
    expect(() => elevationToShadowStyle('1', 'not a shadow')).toThrow();
  });
});
