#!/usr/bin/env node
/**
 * Rebuilds `.output/server/node_modules` from Nitro's own manifest.
 *
 * Nitro writes `.output/server/package.json` with every dependency it decided
 * the bundle needs, at an exact version — 199 of them in this project. What it
 * then *installs* beside that manifest is the part that comes out wrong. So
 * rather than repairing the tree, this throws it away and has npm build the
 * manifest properly.
 *
 * The whole tree has to go, not just the packages that look broken. Nitro's
 * layout is a symlink farm in pnpm's style: ~73 top-level entries are symlinks
 * into `.nitro/<name>@<version>`, which is how two versions of the same
 * package coexist. npm's arborist cannot read that as a node_modules tree and
 * dies on it (`Cannot read properties of null (reading 'fsTop')`), so an
 * install layered on top does not fail halfway — it never starts.
 *
 * Usage: node scripts/vendor-server.mjs
 */
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { outDir, outModules, requireOutput } from './_shared.mjs';

requireOutput();

const serverDir = join(outDir, 'server');

console.log('removing the traced tree …');
await rm(outModules, { recursive: true, force: true });

console.log('installing Nitro\'s manifest with npm …\n');

const install = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
	cwd: serverDir,
	encoding: 'utf8',
});

if (install.status !== 0) {
	console.error(install.stderr || install.stdout);
	process.exit(1);
}

const du = spawnSync('du', ['-sh', outDir], { encoding: 'utf8' });
console.log(`.output is self-contained: ${(du.stdout || '').trim()}`);
console.log('\nRun it with the working directory set to .output/server, where');
console.log('node_modules now sits — Maizzle resolves @maizzle/tailwindcss');
console.log('against process.cwd(), and gets it wrong silently.');
