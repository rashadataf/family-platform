import { describe, expect, it } from 'vitest';
import { andThen, err, isErr, isOk, mapResult, ok, unwrap } from './result.js';

describe('Result', () => {
  it('ok() produces a success result that isOk recognises', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('err() produces a failure result that isErr recognises', () => {
    const result = err('boom');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it('mapResult transforms an ok value and leaves an error untouched', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(mapResult(err('boom'), (n: number) => n * 2)).toEqual(err('boom'));
  });

  it('andThen chains fallible steps and short-circuits on the first error', () => {
    const parsePositive = (n: number) => (n > 0 ? ok(n) : err('not positive'));

    expect(andThen(ok(5), parsePositive)).toEqual(ok(5));
    expect(andThen(ok(-5), parsePositive)).toEqual(err('not positive'));
    expect(andThen(err('already broken'), parsePositive)).toEqual(err('already broken'));
  });

  it('unwrap returns the value of an ok result', () => {
    expect(unwrap(ok('value'))).toBe('value');
  });

  it('unwrap throws on an error result', () => {
    expect(() => unwrap(err('boom'))).toThrow(/boom/);
  });
});
