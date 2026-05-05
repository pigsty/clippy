import { describe, expect, it } from 'vitest';
import { buildInvalidationPaths, computeInvalidationPaths } from '../src/publishInvalidation';

describe('buildInvalidationPaths', () => {
  it('includes root route variants for index.html changes', () => {
    const paths = buildInvalidationPaths(['index.html'], ['index.html', 'video/a/index.html']);

    expect(paths).toContain('/');
    expect(paths).toContain('/index.html');
  });

  it('includes directory route variants for nested index.html changes', () => {
    const paths = buildInvalidationPaths(
      ['video/a/index.html'],
      ['index.html', 'video/a/index.html', 'video/a/thumb1.jpg']
    );

    expect(paths).toContain('/video/a/');
    expect(paths).toContain('/video/a/index.html');
  });

  it('collapses to directory wildcard when all files in a dir changed', () => {
    const allKeys = [
      'video/a/index.html',
      'video/a/thumb1.jpg',
      'video/a/hls/master.m3u8',
      'video/b/index.html',
    ];
    const changedKeys = ['video/a/index.html', 'video/a/thumb1.jpg', 'video/a/hls/master.m3u8'];

    const paths = buildInvalidationPaths(changedKeys, allKeys);

    expect(paths).toContain('/video/a/*');
    expect(paths).not.toContain('/video/a/index.html');
    expect(paths).not.toContain('/video/a/thumb1.jpg');
    expect(paths).not.toContain('/video/a/hls/master.m3u8');
  });

  it('does not collapse when only some files in a dir changed', () => {
    const allKeys = ['video/a/index.html', 'video/a/thumb1.jpg', 'video/a/hls/master.m3u8'];
    const changedKeys = ['video/a/index.html'];

    const paths = buildInvalidationPaths(changedKeys, allKeys);

    expect(paths).not.toContain('/video/a/*');
    expect(paths).toContain('/video/a/index.html');
    expect(paths).toContain('/video/a/');
  });
});

describe('computeInvalidationPaths', () => {
  it('falls back to /* when computed paths exceed limit', () => {
    const changedKeys = Array.from({ length: 1101 }, (_, i) => `video/${i}/changed.jpg`);
    const allKeys = [
      ...changedKeys,
      ...Array.from({ length: 1101 }, (_, i) => `video/${i}/unchanged.jpg`),
    ];

    const paths = computeInvalidationPaths(changedKeys, allKeys, 1000);

    expect(paths).toEqual(['/*']);
  });

  it('keeps computed paths when at or below limit', () => {
    const changedKeys = ['video/a/index.html', 'video/b/index.html'];
    const allKeys = [...changedKeys];

    const paths = computeInvalidationPaths(changedKeys, allKeys, 1000);

    expect(paths).not.toEqual(['/*']);
    expect(paths.length).toBeGreaterThan(0);
  });
});
