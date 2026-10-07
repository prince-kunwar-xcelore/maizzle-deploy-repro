import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';

const here = dirname(fileURLToPath(import.meta.url));
const fromHere = (...s: string[]) => join(here, ...s).replace(/\\/g, '/');

/**
 * What the tracer cannot see.
 *
 * Everything here is reached at runtime by a call the tracer cannot read
 * statically — a platform branch picking a `.node` file, or an
 * `import.meta.resolve` — so nothing in the import graph leads to it and the
 * trace comes out complete-looking and short.
 *
 * Two things are easy to get wrong. Every entry must be resolvable from the
 * project root, which under pnpm means declaring it even when it is already
 * installed as someone's transitive dependency; an entry that does not
 * resolve is skipped in silence rather than reported. And a package whose
 * `main` is a `.node` file has to be pre-resolved to an absolute path,
 * because Rollup's resolver hands the bare specifier back as an external and
 * the tracer then goes looking for a file by that name in the project root.
 */
function untraceable(): string[] {
	const { platform, arch } = process;
	if (platform !== 'linux') throw new Error(`Extend untraceable() for ${platform}.`);

	const require = createRequire(import.meta.url);

	return [
		// glibc here; a musl runtime needs the -musl packages and a musl build stage.
		`@rolldown/binding-linux-${arch}-gnu`,
		`lightningcss-linux-${arch}-gnu`,
		// Maizzle locates this with import.meta.resolve to alias it for Vite.
		'vue-router',
		// @vitejs/plugin-vue requires this through a createRequire it builds at
		// runtime, inside a try/catch that reports the miss as something else.
		'vue/compiler-sfc',
		// Vite's dep scanner opens this by path to read its exports. No import
		// anywhere leads to it, and changing the trace conditions does not help:
		// the file is read, not imported.
		'vue/dist/vue.runtime.esm-bundler.js',
	].map(name => require.resolve(name));
}

export default defineNuxtConfig({
	compatibilityDate: '2025-07-15',

	nitro: {
		// Maizzle is a build tool, not a leaf library: it starts a Vite SSR server
		// per render. Bundling it produces a server that cannot load its own
		// native pieces, so it is imported at runtime instead.
		externals: {
			external: ['@maizzle/framework', '@maizzle/tailwindcss'],

			// The tracer follows imports it can read. A native binding is chosen by
			// sniffing platform, arch and libc at runtime, so nothing links the
			// server to the one file it will actually load — these name it outright.
			traceInclude: untraceable(),
		},

		// Maizzle resolves components by scanning a directory, and the server
		// bundle has none. The layouts ride along as server assets and are written
		// back out before the first render.
		serverAssets: [{ baseName: 'emailLayouts', dir: fromHere('server/utils/layouts') }],

		handlers: [
			{ route: '/_internal/render', method: 'post', handler: fromHere('server/_internal/render.post.ts') },
		],
	},
});
