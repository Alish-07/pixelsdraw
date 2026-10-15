import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STUDIO_PREFERENCES, STUDIO_PREFERENCES_KEY, editorMenuPosition, parseStudioPreferences, studioPreferences, workspacePanels } from '../lib/studio-preferences.mjs';

test('studio preferences default safely and reject invalid values', () => {
  for (const invalid of [null, '', '{broken', 'null', 'false', '[]']) {
    assert.deepEqual(parseStudioPreferences(invalid), DEFAULT_STUDIO_PREFERENCES);
  }
  assert.deepEqual(studioPreferences({ workspaceMode: 'paid', animateLogo: 'false' }), DEFAULT_STUDIO_PREFERENCES);
  assert.deepEqual(parseStudioPreferences('{"workspaceMode":"advanced","animateLogo":false}'), { workspaceMode: 'advanced', animateLogo: false });
  assert.equal(STUDIO_PREFERENCES_KEY, 'pixelsdraw:studio-preferences:v1');
});

test('switching workspace preferences neither stores nor modifies artwork', () => {
  const frame = Object.freeze({ layers: Object.freeze([{ id: 'original-layer' }]) });
  const document = Object.freeze({ workspaceMode: 'advanced', animateLogo: false, frames: Object.freeze([frame]), activeFrame: 0 });
  const simple = studioPreferences({ ...document, workspaceMode: 'simple' });
  assert.deepEqual(simple, { workspaceMode: 'simple', animateLogo: false });
  assert.equal(document.frames[0], frame);
  assert.equal(document.frames[0].layers[0].id, 'original-layer');
  assert.equal(document.workspaceMode, 'advanced');
  assert.deepEqual(studioPreferences({ ...simple, workspaceMode: 'advanced' }), { workspaceMode: 'advanced', animateLogo: false });
});

test('panel widths stay consistent and reserve a drawable center at desktop widths', () => {
  for (const width of [556, 650, 768, 801, 1000, 1440, 2560]) {
    for (const left of [112, 132, 320, NaN, Infinity]) for (const right of [190, 234, 420, NaN, Infinity]) {
      const resolved = workspacePanels(left, right, width);
      assert.ok(resolved.left >= 112 && resolved.left <= 320);
      assert.ok(resolved.right >= 190 && resolved.right <= 420);
      assert.ok(resolved.left + resolved.right + 254 <= width);
      assert.deepEqual(workspacePanels(resolved.left, resolved.right, width), resolved);
    }
  }
  assert.deepEqual(workspacePanels(132, 234, 1440), { left: 132, right: 234 });
  assert.deepEqual(workspacePanels(NaN, NaN, 0), { left: 132, right: 234 });
});

test('menus stay inside narrow and short viewports', () => {
  for (const width of [320, 390, 820, 1440]) for (const height of [320, 600, 900]) {
    for (const anchor of [{ top: 100, bottom: 140, right: 180 }, { top: height - 60, bottom: height - 20, right: width - 10 }]) {
      const resolved = editorMenuPosition(anchor, Math.min(530, width - 24), 500, width, height);
      assert.ok(resolved.left >= 12);
      assert.ok(resolved.top >= 12);
      assert.ok(resolved.top + resolved.maxHeight <= height - 12);
      assert.ok(resolved.left + Math.min(530, width - 24) <= width - 12);
    }
  }
});
