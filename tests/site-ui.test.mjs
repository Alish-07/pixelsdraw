import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeCountdown, friendlyAuthError, phaseLabel, savedFrameRate } from '../lib/site-ui.mjs';
import { runInNewContext } from 'node:vm';
import { THEME_BOOTSTRAP, isThemePreference } from '../lib/theme-config.mjs';

test('challenge timers handle loading, invalid dates, deadlines and long rounds', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  assert.equal(challengeCountdown('invalid', now), 'Updating…');
  assert.equal(challengeCountdown('2026-10-11T12:00:01Z', 0), '…');
  assert.equal(challengeCountdown('2026-10-11T12:00:00Z', now), 'Closing…');
  assert.equal(challengeCountdown('2026-10-11T12:01:05Z', now), '1m 05s');
  assert.equal(challengeCountdown('2026-10-11T15:12:00Z', now), '3h 12m');
});

test('sign-in errors guide users without exposing provider diagnostics', () => {
  assert.match(friendlyAuthError({status:429}), /wait.*Google/);
  assert.match(friendlyAuthError({message:'Email rate limit exceeded'}), /wait/);
  assert.equal(friendlyAuthError({message:'Invalid email address'}), 'Enter a valid email address.');
  assert.equal(friendlyAuthError({message:'Provider internal exception 123'}), 'Sign-in is unavailable right now. Please try again.');
});

test('room phases and saved animation speed have safe defaults', () => {
  assert.equal(phaseLabel('submissions'), 'Drawing');
  assert.equal(phaseLabel('results'), 'Finished');
  assert.equal(phaseLabel('unrecognized'), 'Competition');
  for (const value of [2, 4, 6, 8, 12, 16, 24]) assert.equal(savedFrameRate(value), value);
  for (const value of [undefined, null, NaN, 0, -1, 999, '12']) assert.equal(savedFrameRate(value), 6);
});

test('early theme respects saved appearance, system changes and unavailable storage', () => {
  for (const [preference, systemDark, expected] of [['dark', false, 'dark'], ['light', true, 'light'], ['system', true, 'dark'], ['bad', false, 'light'], [null, true, 'dark']]) {
    const document = {documentElement: {dataset: {}}};
    runInNewContext(THEME_BOOTSTRAP, {document, localStorage: {getItem: () => preference}, window: {matchMedia: () => ({matches: systemDark})}});
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  const document = {documentElement: {dataset: {}}};
  runInNewContext(THEME_BOOTSTRAP, {document, localStorage: {getItem: () => {throw new Error('blocked');}}, window: {matchMedia: () => ({matches: true})}});
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('unknown'), false);
});
