import { describe, expect, it } from 'vitest';
import { compareNodeVersions } from './verify-node-version.ts';

/**
 * The drift guard is ordinary logic, so it gets ordinary tests. Without them
 * the only way to know it works is to break the Dockerfile on purpose, which
 * is exactly the kind of manual verification a check exists to replace.
 */
describe('compareNodeVersions', () => {
  it('passes when both sources name the same major', () => {
    expect(compareNodeVersions('24\n', 'ARG NODE_VERSION=24\n').ok).toBe(true);
  });

  it('ignores patch and prefix differences, comparing only the major', () => {
    expect(compareNodeVersions('v24.3.0\n', 'ARG NODE_VERSION=24.1.2\n').ok).toBe(true);
  });

  it('fails on a major mismatch, naming both values', () => {
    const result = compareNodeVersions('24\n', 'ARG NODE_VERSION=22\n');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('24');
    expect(result.message).toContain('22');
  });

  it('fails when the Dockerfile has no ARG NODE_VERSION rather than passing silently', () => {
    const result = compareNodeVersions('24\n', 'FROM node:24-bookworm-slim AS base\n');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ARG NODE_VERSION');
  });

  it('fails when .nvmrc holds no recognisable version', () => {
    const result = compareNodeVersions('lts/iron\n', 'ARG NODE_VERSION=24\n');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('.nvmrc');
  });

  it('does not match ARG NODE_VERSION appearing mid-line in a comment', () => {
    const dockerfile = '# see ARG NODE_VERSION=22 below\nARG NODE_VERSION=24\n';

    expect(compareNodeVersions('24\n', dockerfile).ok).toBe(true);
  });
});
