#!/usr/bin/env node
/**
 * Moves the mis-traced packages out of the build output.
 *
 * Node resolves a package by walking up from the importing file and taking the
 * first node_modules that has it, so the incomplete copy Nitro writes is found
 * before the complete one installed above it. Removing the copy is what lets
 * resolution fall through to the install that does carry the native binding.
 */
import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACED, backupDir, outModules, requireOutput } from './_shared.mjs';

requireOutput();
await mkdir(backupDir, { recursive: true });

let moved = 0;

for (const name of TRACED) {
	const from = join(outModules, name);
	if (!existsSync(from)) continue;

	await mkdir(join(backupDir, name, '..'), { recursive: true });
	await rename(from, join(backupDir, name));
	console.log(`moved out  ${name}`);
	moved++;
}

console.log(moved ? `\n${moved} package(s) set aside in .output/.traced-backup` : 'nothing to strip');
