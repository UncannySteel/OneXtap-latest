/**
 * CLAUDE.md rule 10: .env and server/.env are never committed.
 *
 * Both hold live keys. git must ignore them, and neither may already be in the
 * index, where an ignore rule no longer applies. Nothing here reads either
 * file: git answers from paths alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const ENV_FILES = ['.env', 'server/.env'];

test('git ignores .env and server/.env', () => {
  for (const file of ENV_FILES) {
    // --no-index: answer from the ignore rules even if the file is tracked.
    const { status } = spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: repoRoot });
    assert.equal(status, 0, `${file} is not ignored by .gitignore`);
  }
});

test('git tracks neither, nor any other file named .env', () => {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...ENV_FILES], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  assert.deepEqual(listed, [], 'an env file is in the index');

  const anywhere = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter((file) => path.posix.basename(file) === '.env');
  assert.deepEqual(anywhere, [], 'a .env file is in the index');
});
