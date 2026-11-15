// Run with `node --disable-warning=ExperimentalWarning --test e2e/args.test.ts` (no servers, no database).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from './args.ts';

test('accepts --trace off and --trace=off, in any position', () => {
  assert.deepEqual(parseArgs(['--trace', 'off']), { serve: false, only: [] });
  assert.deepEqual(parseArgs(['--trace=off']), { serve: false, only: [] });
  assert.deepEqual(parseArgs(['production', '--trace', 'off', 'auth']), { serve: false, only: ['production', 'auth'] });
});

test('refuses any other --trace, before anything runs', () => {
  for (const bad of [['--trace'], ['--trace', 'on'], ['--trace=on'], ['--trace='], ['--trace', '--serve']]) {
    assert.throws(() => parseArgs(bad), /--trace n'accepte que « off »/, bad.join(' '));
  }
});

test('reads --serve and the spec words', () => {
  assert.deepEqual(parseArgs(['--serve']), { serve: true, only: [] });
  assert.deepEqual(parseArgs(['batiments']), { serve: false, only: ['batiments'] });
});
