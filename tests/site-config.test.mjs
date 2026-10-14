import test from 'node:test';
import assert from 'node:assert/strict';
import { siteUrl, allowIndexing } from '../lib/site-config.mjs';

test('production site origins accept HTTPS and reject unsafe or path URLs', () => {
  assert.equal(siteUrl('https://pixels.example/'), 'https://pixels.example');
  assert.equal(siteUrl('http://localhost:3000'), 'http://localhost:3000');
  for (const value of ['http://pixels.example', 'https://user:pass@pixels.example', 'https://pixels.example/events', 'https://pixels.example?x=1', 'https://pixels.example#x', 'not a URL']) {
    assert.throws(() => siteUrl(value));
  }
});

test('indexing requires an explicit production opt-in and excludes previews', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV, NEXT_PUBLIC_ALLOW_INDEXING: process.env.NEXT_PUBLIC_ALLOW_INDEXING };
  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'false';
    assert.equal(allowIndexing(), false);
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';
    assert.equal(allowIndexing(), true);
    process.env.VERCEL_ENV = 'preview';
    assert.equal(allowIndexing(), false);
    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'production';
    assert.equal(allowIndexing(), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
