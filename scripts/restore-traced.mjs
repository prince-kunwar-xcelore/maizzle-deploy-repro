#!/usr/bin/env node
/** Puts back whatever strip-traced.mjs set aside, returning the build to as-built. */
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACED, backupDir, outModules, requireOutput } from './_shared.mjs';

requireOutput();

if (!existsSync(backupDir)) {
	console.log('nothing to restore');
	process.exit(0);
}

for (const name of TRACED) {
	const from = join(backupDir, name);
	if (!existsSync(from)) continue;

	await rm(join(outModules, name), { recursive: true, force: true });
	await mkdir(join(outModules, name, '..'), { recursive: true });
	await rename(from, join(outModules, name));
	console.log(`restored   ${name}`);
}

await rm(backupDir, { recursive: true, force: true });
console.log('\nbuild output is back to as-built');
