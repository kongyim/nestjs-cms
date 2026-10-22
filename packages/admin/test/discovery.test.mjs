import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSections } from '../scripts/cli.mjs';

test('discovers new sections, ignores helpers, removes deleted sections, and leaves unchanged output alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-admin-'));
  try {
    const dir = join(root, 'sections');
    await mkdir(dir);
    const out = join(root, 'sections.generated.ts');
    for (const name of [
      'users.ts',
      'pages.tsx',
      '_helper.ts',
      'index.ts',
      'types.d.ts',
      'pages.test.ts',
    ])
      await writeFile(join(dir, name), 'export default {};');
    assert.deepEqual(await generateSections(dir, out), [
      'pages.tsx',
      'users.ts',
    ]);
    assert.match(
      await readFile(out, 'utf8'),
      /import section0 from "\.\/sections\/pages"/,
    );
    const before = (await stat(out)).mtimeMs;
    await generateSections(dir, out);
    assert.equal((await stat(out)).mtimeMs, before);
    await writeFile(join(dir, 'categories.ts'), 'export default {};');
    await rm(join(dir, 'pages.tsx'));
    assert.deepEqual(await generateSections(dir, out), [
      'categories.ts',
      'users.ts',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('npm-style symlink entrypoint runs the generator', async () => {
  const { symlink } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'cms-admin-bin-'));
  try {
    await mkdir(join(root, 'src/sections'), { recursive: true });
    await writeFile(join(root, 'src/sections/pages.ts'), 'export default {};');
    const bin = join(root, 'cms-admin');
    await symlink(
      fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url)),
      bin,
    );
    execFileSync(process.execPath, [bin, 'generate'], { cwd: root });
    assert.match(
      await readFile(join(root, 'src/sections.generated.ts'), 'utf8'),
      /sections\/pages/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development watcher regenerates imports on section additions and removals', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'cms-admin-watch-'));
  const directory = join(root, 'src/sections');
  const output = join(root, 'src/sections.generated.ts');
  await mkdir(directory, { recursive: true });
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url)), 'dev'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  async function waitFor(check) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Section watcher did not regenerate imports.');
  }
  try {
    await once(child.stdout, 'data');
    await writeFile(join(directory, 'products.ts'), 'export default {};');
    await waitFor(async () =>
      (await readFile(output, 'utf8')).includes('sections/products'),
    );
    await rm(join(directory, 'products.ts'));
    await waitFor(
      async () =>
        !(await readFile(output, 'utf8')).includes('sections/products'),
    );
  } finally {
    child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
