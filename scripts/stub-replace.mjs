#!/usr/bin/env node
/**
 * Emulates the "remove the broken stubs, copy in the real ones" Dockerfile:
 *
 *   RUN rm -rf .output/server/node_modules/{rolldown,@rolldown,@maizzle}
 *   COPY --from=builder /app/node_modules/<pkg> .output/server/node_modules/<pkg>
 *
 * `COPY --from` dereferences symlinks, so the copy here does too — that is the
 * detail that decides whether a pnpm source tree survives the trip.
 *
 * Usage: node scripts/stub-replace.mjs [--source <node_modules>] [--packages a,b,c]
 */
import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { outModules, requireOutput, root } from './_shared.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

requireOutput();

const source = flag('source', join(root, 'node_modules'));
const packages = flag('packages', 'rolldown,@rolldown,@maizzle').split(',').filter(Boolean);

console.log(`source   : ${source}`);
console.log(`packages : ${packages.join(' ')}\n`);

// Step 2 of the Dockerfile: drop the stubs the tracer wrote.
for (const name of packages) {
	const dir = join(outModules, name);
	if (!existsSync(dir)) { console.log(`rm   ${name} (absent)`); continue; }
	await rm(dir, { recursive: true, force: true });
	console.log(`rm   ${name}`);
}

// Step 3: copy the real ones in. A missing source is the `COPY` that would
// have failed the image build, so it is reported the same way Docker would.
let failed = false;

for (const name of packages) {
	const from = join(source, name);
	if (!existsSync(from)) {
		console.log(`COPY ${name}  -> FAILED: "${from}" not found`);
		failed = true;
		continue;
	}
	await cp(from, join(outModules, name), { recursive: true, dereference: true });
	console.log(`COPY ${name}  -> ok`);
}

if (failed) {
	console.log('\nThe image build would have stopped here.');
	process.exit(1);
}
