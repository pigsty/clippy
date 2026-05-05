function directoryPrefixesForKey(key: string): string[] {
  const parts = key.split('/');
  if (parts.length <= 1) {
    return [];
  }

  const prefixes: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    prefixes.push(parts.slice(0, i).join('/'));
  }

  return prefixes;
}

function pathCount(pathValue: string): number {
  return pathValue.split('/').filter(Boolean).length;
}

export function buildInvalidationPaths(changedKeys: string[], allKnownKeys: string[]): string[] {
  const changedSet = new Set(changedKeys);
  const allSet = new Set(allKnownKeys);
  const pathSet = new Set<string>();

  for (const key of changedSet) {
    pathSet.add(`/${key}`);
    if (key === 'index.html') {
      pathSet.add('/');
    }
    if (key.endsWith('/index.html')) {
      const dir = key.slice(0, -'index.html'.length);
      pathSet.add(`/${dir}`);
    }
  }

  const allByDir = new Map<string, Set<string>>();
  const changedByDir = new Map<string, Set<string>>();

  for (const key of allSet) {
    for (const dir of directoryPrefixesForKey(key)) {
      const current = allByDir.get(dir) ?? new Set<string>();
      current.add(key);
      allByDir.set(dir, current);
    }
  }

  for (const key of changedSet) {
    for (const dir of directoryPrefixesForKey(key)) {
      const current = changedByDir.get(dir) ?? new Set<string>();
      current.add(key);
      changedByDir.set(dir, current);
    }
  }

  const fullyChangedDirs: string[] = [];
  for (const [dir, allFiles] of allByDir.entries()) {
    const changedFiles = changedByDir.get(dir);
    if (allFiles.size > 0 && changedFiles && changedFiles.size === allFiles.size) {
      fullyChangedDirs.push(dir);
    }
  }

  fullyChangedDirs.sort((a, b) => {
    const depthDiff = pathCount(a) - pathCount(b);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return a.localeCompare(b);
  });

  const selectedDirs: string[] = [];
  for (const dir of fullyChangedDirs) {
    const alreadyCovered = selectedDirs.some(parent => dir === parent || dir.startsWith(`${parent}/`));
    if (!alreadyCovered) {
      selectedDirs.push(dir);
    }
  }

  for (const dir of selectedDirs) {
    const prefix = `/${dir}/`;
    for (const pathValue of Array.from(pathSet)) {
      if (pathValue === `/${dir}` || pathValue.startsWith(prefix)) {
        pathSet.delete(pathValue);
      }
    }
    pathSet.add(`/${dir}/*`);
  }

  return Array.from(pathSet).sort((a, b) => a.localeCompare(b));
}

export function computeInvalidationPaths(
  changedKeys: string[],
  allKnownKeys: string[],
  maxPaths = 1000
): string[] {
  const paths = buildInvalidationPaths(changedKeys, allKnownKeys);
  return paths.length > maxPaths ? ['/*'] : paths;
}
