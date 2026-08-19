import { readFileSync, writeFileSync } from 'node:fs';

const placeholder = "'__OPTIVISE_PACKAGED_BACKEND_URL__'";
const configured = process.env.OPTIVISE_PACKAGED_BACKEND_URL?.trim() || 'https://api.optivise.cc';
const parsed = new URL(configured);
const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';

if ((parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error('OPTIVISE_PACKAGED_BACKEND_URL must be HTTPS (or HTTP loopback) without credentials, query, or fragment');
}

const authPath = new URL('../dist/auth.js', import.meta.url);
const source = readFileSync(authPath, 'utf8');
if (!source.includes(placeholder)) {
  throw new Error('Packaged backend placeholder was not found in dist/auth.js');
}
writeFileSync(authPath, source.replaceAll(placeholder, JSON.stringify(configured.replace(/\/$/, ''))), 'utf8');
