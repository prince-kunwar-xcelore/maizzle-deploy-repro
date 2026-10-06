# maizzle-deploy-repro

A minimal Nuxt 4 app that renders an email on demand with Maizzle, built to show
what happens to that render when the app goes through a production build.

It mirrors the shape of the email template studio: layouts ride along as Nitro
server assets, get written back to disk before rendering, and `@maizzle/framework`
is marked external so Nitro does not bundle it.

```
pnpm install
pnpm build
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
| vendored, cwd = project | yes | no | no |
| vendored, cwd = `.output` | **yes** | **yes** | **yes** |

Three things are worth reading off that table.

**As built, it does not even start.** Not a render-time error — the process dies
on load with `Cannot find native binding`, and it dies even with the full
install sitting right above it, because the traced copy is found first.

**Adding back what the tracer missed does not converge.** Copying in the native
binding gets past rolldown and straight into the next missing package. Run
`pnpm audit` (the script here, not npm's) to see the size of the gap: the traced
output declares **36 dependencies it does not carry**. Each one supplied reveals
the next.

**The working directory matters, separately from resolution.** Maizzle resolves
`@maizzle/tailwindcss` itself at runtime, relative to `process.cwd()`, outside
the import graph entirely. Row 6 starts and renders but produces a document with
no styles at all, because Tailwind never ran. In this repro that surfaces as a
422; in a larger app it can return **200 with a perfectly well-formed, entirely
unstyled email** — a silent wrong answer rather than a crash.

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
  resolution fails as described above.

Size here: `.output` goes from 70M as built to 303M vendored. A real pipeline
would use `pnpm deploy --prod` to get the same closure without dev dependencies.

## Still unsolved

The build and runtime images must share a libc. Only the binding matching the
build machine is ever installed, so a glibc build stage feeding a musl runtime
stage has no binding to find, however the packaging is arranged.
