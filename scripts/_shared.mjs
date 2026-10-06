import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = join(root, '.output');
export const outModules = join(outDir, 'server', 'node_modules');
export const backupDir = join(outDir, '.traced-backup');

/**
 * The packages Nitro's tracer copies incorrectly. `rolldown` is the one that
 * actually breaks — its native binding lives in a platform-specific optional
 * dependency the tracer cannot follow — but the whole Vite chain has to move
 * together, or a half-traced copy still shadows the real install.
 */
export const TRACED = ['@maizzle', 'vite', '@vitejs', 'rolldown', '@rolldown'];

export function requireOutput() {
	if (!existsSync(outDir)) {
		console.error('No .output found. Run `pnpm build` first.');
		process.exit(1);
	}
}

/** The @rolldown/binding-* package matching this machine, as rolldown would pick it. */
export function bindingPackageName() {
	const { platform, arch } = process;

	if (platform === 'linux') {
		const require = createRequire(import.meta.url);
		let musl = false;
		try {
			musl = require('node:fs').readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
		} catch { /* glibc images have no /usr/bin/ldd to read */ }
		return `@rolldown/binding-linux-${arch}-${musl ? 'musl' : 'gnu'}`;
	}

	if (platform === 'darwin') return `@rolldown/binding-darwin-${arch}`;
	if (platform === 'win32') return `@rolldown/binding-win32-${arch}-msvc`;

	throw new Error(`No known rolldown binding for ${platform}/${arch}.`);
}
