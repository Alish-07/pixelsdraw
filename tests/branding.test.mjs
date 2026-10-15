import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE_NAME, CURRENT_SITE } from '../lib/site-config.mjs';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('rebranding keeps the existing production origin', () => {
  assert.equal(SITE_NAME, 'PixelsDraw');
  assert.equal(CURRENT_SITE, 'https://pixel-art-studio-alpha-one.vercel.app');
});

test('comet assets are self-contained and static alternatives contain no animation', async () => {
  const animated = await source('public/brand/pixel-comet-animated.svg');
  const still = await source('public/brand/pixel-comet-static.svg');
  const icon = await source('app/icon.svg');
  for (const asset of [animated, still, icon]) {
    assert.match(asset, /<svg[^>]+viewBox=/);
    assert.match(asset, /PixelsDraw/);
    assert.doesNotMatch(asset, /<script|<foreignObject|\son\w+=|(?:href|src)=/i);
  }
  assert.match(animated, /prefers-reduced-motion: reduce/);
  assert.match(animated, /animation: none/);
  assert.doesNotMatch(still + icon, /animation:|<animate|@keyframes/);
  assert.match(icon, /viewBox="0 0 32 32"/);
});

test('brand animation has a user-controlled static fallback', async () => {
  const logo = await source('components/BrandLogo.js');
  assert.match(logo, /aria-pressed=\{paused\}/);
  assert.match(logo, /Pause logo animation/);
  assert.match(logo, /Play logo animation/);
  assert.match(logo, /prefers-reduced-motion: reduce/);
  assert.match(logo, /paused \? "\/brand\/pixel-comet-static.svg"/);
});

test('legacy mobile styles do not hide the brand wordmark', async () => {
  assert.doesNotMatch(await source('app/globals.css'), /\.brand\s*>\s*span:last-child\s*\{\s*display:\s*none/);
});

test('public-facing names and metadata no longer use the old brand', async () => {
  for (const path of [
    'components/SiteHeader.js', 'components/SiteFooter.js', 'components/PolicyPage.js',
    'app/layout.js', 'app/page.js', 'app/events/page.js', 'app/privacy/page.js', 'app/terms/page.js',
  ]) {
    assert.doesNotMatch(await source(path), /Pixel Art Studio/, path);
  }
});
