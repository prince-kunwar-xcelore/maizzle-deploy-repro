#!/usr/bin/env node
/**
 * Lists the dependencies the traced output declares but does not carry.
 *
 * This is the evidence that the trace cannot be patched package by package:
 * every name here is one the output would fail on, and fixing one only reveals
 * the next.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { outModules, requireOutput } from './_shared.mjs';

requireOutput();

const have = new Set();
for (const entry of readdirSync(outModules)) {
	if (entry.startsWith('@')) {
		for (const sub of readdirSync(join(outModules, entry))) have.add(`${entry}/${sub}`);
	} else {
		have.add(entry);
	}
}

const missing = new Map();
for (const name of have) {
	const manifest = join(outModules, name, 'package.json');
	if (!existsSync(manifest)) continue;

	const declared = JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {};
	for (const dep of Object.keys(declared)) {
		if (have.has(dep)) continue;
		if (!missing.has(dep)) missing.set(dep, []);
		missing.get(dep).push(name);
	}
}

console.log(`packages present : ${have.size}`);
console.log(`declared but absent : ${missing.size}\n`);

for (const [dep, needers] of [...missing].sort()) {
	console.log(`  ${dep.padEnd(32)} needed by ${needers.slice(0, 3).join(', ')}${needers.length > 3 ? ` +${needers.length - 3}` : ''}`);
}
