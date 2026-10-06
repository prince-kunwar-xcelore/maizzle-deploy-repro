#!/usr/bin/env node
/**
 * Makes the build output self-contained and correct.
 *
 * Two things do not work and are worth knowing about before reading this:
 *
 * 1. Adding back only what the tracer missed does not converge. Run
 *    `node scripts/audit.mjs` — the traced output declares dozens of
 *    dependencies it does not carry, and supplying one reveals the next.
 *
 * 2. Copying pnpm's `node_modules` in wholesale does not work either. pnpm
 *    links each package to a store and keeps its dependencies beside it there;
 *    copying with symlinks dereferenced flattens that apart, and the package
 *    can no longer see its own neighbours.
 *
 * What works is installing the externals properly inside `.output`, in a flat
 * layout, one level above `server/` where Node finds it walking up.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACED, outDir, outModules, requireOutput, root } from './_shared.mjs';

requireOutput();

for (const name of TRACED) {
	const dir = join(outModules, name);
	if (!existsSync(dir)) continue;
	await rm(dir, { recursive: true, force: true });
	console.log(`dropped mis-traced  ${name}`);
}

// Only the packages left external need to be here; everything else is already
// inside the bundle. Their versions are taken from this project so the output
// carries what it was built against.
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const externals = ['@maizzle/framework', '@maizzle/tailwindcss'];

await writeFile(
	join(outDir, 'package.json'),
	`${JSON.stringify({
		name: 'output-runtime',
		private: true,
		type: 'module',
		dependencies: Object.fromEntries(
			externals.map(name => [name, manifest.dependencies[name]]),
		),
	}, null, 2)}\n`,
);

console.log(`\ninstalling ${externals.join(', ')} into .output …`);

// npm rather than pnpm: a flat node_modules has no links out of the tree, so
// the directory can be copied into an image and still resolve.
const install = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
	cwd: outDir,
	encoding: 'utf8',
});

if (install.status !== 0) {
	console.error(install.stderr || install.stdout);
	process.exit(1);
}

const du = spawnSync('du', ['-sh', outDir], { encoding: 'utf8' });
console.log(`\n.output is self-contained: ${(du.stdout || '').trim()}`);
