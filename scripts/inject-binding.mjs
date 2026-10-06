#!/usr/bin/env node
/**
 * Adds the missing native binding to the traced output instead of deleting the
 * traced copy.
 *
 * Nitro's trace of `rolldown` is complete apart from one thing: the Rust binary,
 * which ships as a platform-specific optional dependency picked at runtime by
 * sniffing platform, arch and libc. The tracer cannot follow that choice, so it
 * copies none of them. Copying in the one this machine would pick is the
 * smallest change that leaves the output able to resolve it.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bindingPackageName, outModules, requireOutput, root } from './_shared.mjs';

requireOutput();

const name = bindingPackageName();
const [scope, bare] = name.split('/');

/**
 * Finds the installed binding.
 *
 * Plain resolution only works when the package is reachable from somewhere we
 * can name. Under pnpm it is a transitive dependency of a transitive
 * dependency, present in the store but linked nowhere we can address, so the
 * store is scanned directly as a fallback.
 */
async function locate() {
	for (const from of [root, join(root, 'node_modules', 'rolldown')]) {
		if (!existsSync(from)) continue;
		try {
			return dirname(createRequire(join(from, 'noop.js')).resolve(`${name}/package.json`));
		} catch { /* not reachable from here; try the next anchor */ }
	}

	const store = join(root, 'node_modules', '.pnpm');
	if (!existsSync(store)) return null;

	for (const entry of await readdir(store)) {
		if (!entry.startsWith(`${scope.replace('@', '')}+${bare}@`.replace('rolldown+', '@rolldown+'))
			&& !entry.startsWith(`@rolldown+${bare}@`)) continue;

		const candidate = join(store, entry, 'node_modules', scope, bare);
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

const source = await locate();

if (!source) {
	console.error(`${name} is not installed here.`);
	console.error('It is an optional dependency of rolldown, installed only on a matching platform.');
	console.error('Build on the same OS and libc you deploy to.');
	process.exit(1);
}

const target = join(outModules, scope, bare);
await mkdir(dirname(target), { recursive: true });

// dereference: pnpm links into a content-addressed store, and a symlink
// pointing outside .output would defeat the point of copying at all.
await cp(source, target, { recursive: true, dereference: true });

console.log(`copied ${name}`);
console.log(`  from ${source}`);
console.log(`    to ${target}`);
