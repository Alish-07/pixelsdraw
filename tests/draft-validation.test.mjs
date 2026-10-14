import test from 'node:test';
import assert from 'node:assert/strict';
import { validEditorDraft } from '../lib/pixel-document.mjs';

const draft = () => ({width:2, height:2, frames:[{layers:[{name:'Layer 1', opacity:1, visible:true, pixels:[null, '#FFFFFF', '#aabbcc', null]}]}]});

test('editable drafts enforce dimensions, layer values and competition sizes', () => {
  assert.equal(validEditorDraft(draft()), true);
  assert.equal(validEditorDraft(draft(), 2), true);
  assert.equal(validEditorDraft(draft(), 32), false);
  for (const value of [null, {}, {...draft(), width:0}, {...draft(), width:4097}, {...draft(), height:4097}, {...draft(), width:1025, height:1024}, {...draft(), frames:[null]}, {...draft(), frames:[{layers:[null]}]}]) assert.equal(validEditorDraft(value), false);
  for (const change of [{opacity:NaN}, {opacity:2}, {visible:'true'}, {pixels:['bad']}, {name:123}]) {
    const value=draft(); Object.assign(value.frames[0].layers[0], change);
    assert.equal(validEditorDraft(value), false);
  }
});
