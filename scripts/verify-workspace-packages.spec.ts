import { describe, expect, it } from 'vitest';
import { checkDeclarations } from './verify-workspace-packages.ts';

const COPY_LINE = 'COPY packages/testing/package.json packages/testing/\n';

const complete = {
  dockerfiles: {
    'apps/api/Dockerfile': COPY_LINE,
    'apps/worker/Dockerfile': COPY_LINE,
  },
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
    const result = checkDeclarations(['packages/testing'], {
      ...complete,
      dockerfiles: { ...complete.dockerfiles, 'apps/api/Dockerfile': '' },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('apps/api/Dockerfile');
    expect(result.message).toContain('COPY packages/testing/package.json');
  });

  // The regression this check did not previously cover: `packages/ui` was
  // added to the API's Dockerfile and not the worker's, and nothing said so.
  it('catches a package declared in one image but not the other', () => {
    const result = checkDeclarations(['packages/testing'], {
      ...complete,
      dockerfiles: { ...complete.dockerfiles, 'apps/worker/Dockerfile': '' },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('apps/worker/Dockerfile');
    expect(result.message).not.toContain('missing from apps/api/Dockerfile');
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
      dockerfiles: { 'apps/api/Dockerfile': '', 'apps/worker/Dockerfile': '' },
      compose: '',
      cruiser: '',
    });

    expect(result.message).toContain('4 workspace declaration(s) missing');
  });

  it('passes vacuously with no packages', () => {
    expect(checkDeclarations([], complete).ok).toBe(true);
  });
});
