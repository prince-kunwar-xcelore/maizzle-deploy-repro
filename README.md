# maizzle-deploy-repro

A minimal Nuxt 4 app that renders an email on demand with Maizzle, built to show
what happens to that render when the app goes through a production build.

It mirrors the shape of the email template studio: layouts ride along as Nitro
server assets, get written back to disk before rendering, and `@maizzle/framework`
is marked external so Nitro does not bundle it.

```
pnpm install
PORT=3300 pnpm dev      # open http://localhost:3300
```

The page renders an email through the server route and shows two badges:
whether the render succeeded, and whether Tailwind actually inlined anything.
The second is the one to watch — most of the interesting failures still return
a complete document.

To see what a production build does, build it and serve each state:

```
pnpm build
pnpm serve                              # as built — dies on startup
pnpm strip   && pnpm serve              # works, by falling through to the install above
pnpm restore && pnpm serve --hide-deps  # as built, shipped alone — dies
pnpm vendor  && pnpm serve --hide-deps              # loads, but unstyled
                pnpm serve --hide-deps --cwd .output  # fully works
```

`--hide-deps` renames the project's `node_modules` aside for the lifetime of
the server, which is what a slim container image looks like: nothing for Node
to find on the way up except what is inside `.output`. It is put back when the
process exits.

Or run every scenario at once without a browser:

```
pnpm matrix --vendor
```

## Why this exists

Maizzle is not a library the server calls; it is a build tool the server *runs*.
Each render starts a Vite SSR server in-process, and under Vite sits rolldown,
whose actual engine is a Rust binary chosen at runtime by sniffing platform,
arch and libc.

That makes Vite and rolldown **runtime** dependencies of a production server,
which is unusual — normally they are build-time only and never ship. Nitro's
dependency tracer cannot follow a native binding selected by a runtime branch,
so the copy it writes into `.output/server/node_modules` is incomplete, and
being nearer on Node's resolution path it shadows the complete install above it.

## What each scenario does

Measured on Linux x64 (glibc), Nuxt 4.5.2, Maizzle 6.1.7, rolldown 1.2.12.
"Shipped alone" hides the project's `node_modules`, which is what a slim
container image looks like.

| scenario | starts | renders | styled |
| --- | --- | --- | --- |
| as built, install above | no | no | no |
| as built, shipped alone | no | no | no |
| stripped, install above | **yes** | **yes** | **yes** |
| stripped, shipped alone | no | no | no |
| binding added, shipped alone | no | no | no |
| vendored, cwd = project | yes | **yes** | **no** |
| vendored, cwd = `.output` | **yes** | **yes** | **yes** |

Three things are worth reading off that table.

**As built, it does not even start.** Not a render-time error — the process dies
on load with `Cannot find native binding`, and it dies even with the full
install sitting right above it, because the traced copy is found first.

**Adding back what the tracer missed does not converge.** Copying in the native
binding gets past rolldown and straight into the next missing package. Run
`pnpm build && pnpm audit` (the script here, not npm's) to see the size of the
gap on a fresh build: the traced output declares **36 dependencies it does not
carry**. Each one supplied reveals the next.

The audit reads whatever state `.output` is currently in, so run it straight
after a build — `pnpm matrix` leaves the output vendored, where the number is
lower because the mis-traced copies have been dropped.

**The working directory matters, separately from resolution.** Maizzle resolves
`@maizzle/tailwindcss` itself at runtime, relative to `process.cwd()`, outside
the import graph entirely. Nothing in the app's source names it, so getting the
bundling right does not cover it.

The second-to-last row is the one worth sitting with: it answers **HTTP 200
with a complete, well-formed email carrying no styles at all**. Not a crash, not
an error response — a success, with the wrong document. The only trace is a line
in the server log:

```
Error: Can't resolve '@maizzle/tailwindcss' in '<cwd>'
```

The two bottom rows differ in nothing but the working directory.

## Scripts

| script | what it does |
| --- | --- |
| `pnpm build` | ordinary `nuxt build` |
| `pnpm probe` | start the built server, render one email, report start/render/styles |
| `pnpm audit` | list dependencies the traced output declares but does not carry |
| `pnpm strip` | move the mis-traced packages aside into `.output/.traced-backup` |
| `pnpm restore` | put them back, returning the build to as-built |
| `pnpm inject-binding` | copy in the native binding the tracer could not follow |
| `pnpm vendor` | drop the mis-traced copies and install the externals into `.output` |
| `pnpm matrix` | run every scenario against one build and print the table |

`probe` takes `--cwd`, `--out` and `--port`, which is how the working-directory
difference above is demonstrated.

## The shape that works

`pnpm vendor` drops the five mis-traced packages and runs a flat `npm install`
of just the external packages inside `.output`, one level above `server/` where
Node finds it walking up. The result is self-contained and relocatable.

Two details that are easy to get wrong:

- **npm, not a copied pnpm tree.** pnpm links each package to a store and keeps
  its dependencies beside it there. Copying that tree with symlinks dereferenced
  flattens it apart and packages stop seeing their own neighbours — it fails on
  the first transitive import. A flat install has no links leaving the tree.
- **Run with the working directory set to `.output`.** Otherwise Tailwind
  resolution fails as described above — silently, with a 200.

A render guard that only checks for an `<html>` element does not catch the
unstyled case, because the document is structurally perfect. Checking for at
least one inlined declaration is what distinguishes them.

Size here: `.output` goes from 70M as built to 303M vendored. A real pipeline
would use `pnpm deploy --prod` to get the same closure without dev dependencies.

## Still unsolved

The build and runtime images must share a libc. Only the binding matching the
build machine is ever installed, so a glibc build stage feeding a musl runtime
stage has no binding to find, however the packaging is arranged.

## Does the official `@maizzle/nuxt` module change any of this?

No. Tested on branch `test/maizzle-nuxt-module`.

The module is seventeen lines. Its entire body:

```js
setup(options, nuxt) {
  options.content ??= [emailsGlob]
  options.output = { path: 'server/assets/emails', ...options.output }
  options.server = { port: 4321, ...options.server }
  addVitePlugin(maizzle(options))
}
```

It registers a **Vite plugin** and sets three defaults. It does not touch Nitro,
externals, tracing, or the runtime at all.

What it gives you is the build-time path, and that path works well: with
`app/emails/welcome.vue` present, `nuxt build` emits
`server/assets/emails/welcome.html` with Tailwind compiled and CSS inlined, and
Nitro bundles it to `chunks/raw/welcome.mjs`. Read back at runtime with
`useStorage('assets:server').getItem('emails:welcome.html')`.

What it does not give you is anything for `render()`. The docs' Server API
section imports `render` straight from `@maizzle/framework` — the module is not
in that picture. With the module registered, the matrix above is unchanged:

```
│ 0 │ 'as built, install above'      │ no  │ no  │ no  │
│ 1 │ 'as built, shipped alone'      │ no  │ no  │ no  │
│ 2 │ 'stripped, install above'      │ yes │ yes │ yes │
│ 3 │ 'stripped, shipped alone'      │ no  │ no  │ no  │
│ 4 │ 'binding added, shipped alone' │ no  │ no  │ no  │
```

Row 0 fails with the same `Cannot find native binding` as without it.

## Is our custom layout the cause?

No. Tested on branch `test/docs-shape-builtin-components`.

The Nuxt guide never places a custom layout anywhere. Every template in it is
built from Maizzle's own auto-imported components (`Layout`, `Container`,
`Heading`, `Button`); the only path option it documents is `static.source`, for
images. The `<Default>` layout, the `serverAssets` entry and the
materialise-to-disk step in `emailRender.ts` are all ours.

So this branch removes every one of them: no `serverAssets`, no
`components.source`, no files written at runtime, just an SFC string of
built-in components passed to `render()` — the docs' shape exactly.

The matrix is unchanged:

```
│ 0 │ 'as built, install above'      │ no  │ no  │ no  │
│ 1 │ 'as built, shipped alone'      │ no  │ no  │ no  │
│ 2 │ 'stripped, install above'      │ yes │ yes │ yes │
│ 3 │ 'stripped, shipped alone'      │ no  │ no  │ no  │
│ 4 │ 'binding added, shipped alone' │ no  │ no  │ no  │
```

Row 2 passing confirms the stripped-down template is valid and Tailwind still
runs through it. Row 0 fails with the same `Cannot find native binding`.

The crash happens while the server is still starting, before any template is
parsed or any component is resolved, so component placement cannot affect it.
