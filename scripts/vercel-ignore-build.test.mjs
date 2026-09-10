import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./vercel-ignore-build.mjs', import.meta.url));
test('deployment checks the complete undeployed range and builds on uncertainty', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tyrepulse-build-rule-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const check = (sha) => spawnSync(process.execPath, [script], {
    cwd, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: sha }, encoding: 'utf8',
  }).status;
  const commit = (file, value) => {
    writeFileSync(join(cwd, file), value);
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    mkdirSync(join(cwd, 'src'));
    mkdirSync(join(cwd, 'tyre_pulse_flutter'));
    const deployed = commit('src/app.js', 'original');
    commit('src/app.js', 'fixed');
    const webTip = commit('CODEX_CONTEXT.md', 'memory update');
    assert.equal(check(deployed), 1, 'web fix followed by docs must build');
    commit('CODEX_CONTEXT.md', 'docs only');
    assert.equal(check(webTip), 0, 'only docs since deployed version can skip');
    commit('tyre_pulse_flutter/app.dart', 'mobile only');
    assert.equal(check(webTip), 0, 'mobile-only changes can skip');
    assert.equal(check(''), 1, 'missing baseline builds');
    assert.equal(check('a'.repeat(40)), 1, 'unavailable shallow history builds');
    assert.equal(check('--help'), 1, 'invalid baseline builds');
    commit('vercel.json', '{}');
    assert.equal(check(webTip), 1, 'deployment configuration changes build');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
