import { describe, expect, it } from 'vitest';
import { checkDeclarations } from './verify-workspace-packages.ts';

const complete = {
  dockerfile: 'COPY packages/testing/package.json packages/testing/\n',
  compose: '      - testing_node_modules:/app/packages/testing/node_modules\n',
  cruiser: "  'packages/testing': ['packages/persistence'],\n",
};

describe('checkDeclarations', () => {
  it('passes when a package is declared in all three places', () => {
    const result = checkDeclarations(['packages/testing'], complete);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 workspace packages');
  });

  it('catches a missing Dockerfile COPY, which only breaks the container path', () => {
    const result = checkDeclarations(['packages/testing'], { ...complete, dockerfile: '' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('apps/api/Dockerfile');
    expect(result.message).toContain('COPY packages/testing/package.json');
  });

  it('catches a missing compose volume, which leaves dangling pnpm symlinks', () => {
    const result = checkDeclarations(['packages/testing'], { ...complete, compose: '' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('docker-compose.yml');
  });

  it('catches a package absent from the boundary graph', () => {
    const result = checkDeclarations(['packages/testing'], { ...complete, cruiser: '' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('WORKSPACE_GRAPH');
  });

  it('is not fooled by a different package with a similar name', () => {
    const result = checkDeclarations(['packages/test'], complete);

    expect(result.ok).toBe(false);
  });

  it('reports every missing declaration at once', () => {
    const result = checkDeclarations(['packages/testing'], {
      dockerfile: '',
      compose: '',
      cruiser: '',
    });

    expect(result.message).toContain('3 workspace declaration(s) missing');
  });

  it('passes vacuously with no packages', () => {
    expect(checkDeclarations([], complete).ok).toBe(true);
  });
});
