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

## The "replace the broken stubs" shape

A natural thing to reach for is to let Nitro trace normally, delete the
packages it got wrong, and copy the real ones in from the builder's
`node_modules`:

```dockerfile
RUN rm -rf .output/server/node_modules/rolldown \
           .output/server/node_modules/@rolldown \
           .output/server/node_modules/@maizzle

COPY --from=builder /app/node_modules/rolldown   .output/server/node_modules/rolldown
COPY --from=builder /app/node_modules/@rolldown  .output/server/node_modules/@rolldown
COPY --from=builder /app/node_modules/@maizzle   .output/server/node_modules/@maizzle
```

`pnpm stub-replace` runs those two steps against `.output`, and `pnpm converge`
then boots the result in an isolated directory, reads whichever package Node
says is missing, copies that one in, and goes again — so the question "how many
packages is it really?" gets an answer rather than an estimate.

```
pnpm build
pnpm stub-replace --source <a flat node_modules>
pnpm converge --image <dir holding .output> --source <the same node_modules>
```

It does not converge. Measured on the same machine as the table above:

| step | what happens |
| --- | --- |
| `COPY` from a pnpm tree | **fails at image build.** `node_modules/rolldown` and `node_modules/@rolldown` do not exist — pnpm's default layout keeps transitive packages in `.pnpm`, and only direct dependencies are linked at the top level. |
| `COPY` from a flat tree | succeeds, so everything below assumes npm or `node-linker=hoisted` |
| boot | `Cannot find package 'vue-router'` |
| + `vue-router` | `Cannot find module '../lightningcss.linux-x64-gnu.node'` — **a second native binding**, in a package the three-line list does not mention |
| + `lightningcss-linux-x64-gnu` | server starts. Render fails: `Failed to resolve vue/compiler-sfc` |
| replace `vue` | same error — the real miss is `@vue/compiler-sfc`, swallowed by a `catch` in `@vitejs/plugin-vue` and reported as something else |
| + `@vue/compiler-sfc` | `No "exports" main defined in .../estree-walker/package.json` |
| + nested `estree-walker@2` | `TypeError: MagicString is not a constructor` |

The last three rows are where it stops being a matter of patience.

**The traced tree is a symlink farm, and a copied package lands outside it.**
Nitro's layout is pnpm's in miniature: 73 of the top-level entries in
`.output/server/node_modules` are symlinks into `.nitro/<name>@<version>`, and
packages needing a second version get a nested `node_modules` holding it. Both
`estree-walker@2.0.2` and `3.0.3` are present in this build — `@vue/compiler-core`
has 2.x nested underneath it, and the top-level `estree-walker` is a symlink to
`.nitro/estree-walker@3.0.3`. A hand-copied `@vue/compiler-sfc` arrives with no
nested copy of its own, walks up to that symlink, and binds 3.x while needing 2.x.

Nesting the right version underneath fixes that one and surfaces
`MagicString is not a constructor`, which is the same collision again with no
error naming the package. At that point the work is no longer "copy some
packages"; it is reimplementing an installer's version resolution by hand,
against an error channel that has started lying.

`pnpm vendor` sidesteps the whole class: it drops the mis-traced packages
rather than repairing them, and lets a real installer build the tree.
`Dockerfile` in this repo is that shape, and the two states were measured the
same way — `.output` copied into an empty directory with nothing resolvable
above it, which is what the image actually looks like:

| packaging | starts | renders | styled |
| --- | --- | --- | --- |
| stubs replaced, flat builder tree | yes | **no** | no |
| vendored, `WORKDIR /app` | yes | yes | **no** |
| vendored, `WORKDIR /app/.output` | **yes** | **yes** | **yes** |

The middle row is the silent one: HTTP 200, a complete email, no styles.

## Rebuilding the traced tree instead of repairing it

There is a better target than `.output/node_modules`. Nitro already writes
`.output/server/package.json` listing every dependency the bundle needs at an
exact version — 199 of them here, against the 173 directories it ships. The
manifest is right; only the install beside it is wrong. So the tree can be
thrown away and rebuilt from Nitro's own list:

```
pnpm build
pnpm vendor-server
node server/index.mjs   # from inside .output/server
```

**The whole tree has to go, not just the packages that look broken.** Layering
`npm install` over the traced tree does not work, and it does not fail
gracefully either — npm's arborist cannot read the `.nitro` symlink farm as a
node_modules layout and aborts before installing anything:

```
npm error Cannot read properties of null (reading 'fsTop')
```

Delete `node_modules` first and npm has an ordinary manifest and an empty
directory, which is a problem it knows how to solve. It resolves the version
conflicts Nitro was using `.nitro` for by nesting, the way it always does.

Measured the same way as the other rows — `.output` copied into an empty
directory with nothing resolvable above it:

| packaging | `.output` | starts | renders | styled |
| --- | --- | --- | --- | --- |
| as built | 89M | no | no | no |
| stubs replaced from a flat tree | — | yes | no | no |
| `npm install` layered on the traced tree | — | \- | \- | \- (npm aborts) |
| vendored, cwd = `.output` | 304M | yes | yes | yes |
| **manifest rebuilt, cwd = `.output/server`** | **262M** | **yes** | **yes** | **yes** |

It comes out smaller than `pnpm vendor`, because the manifest is the traced
set rather than the app's full external closure, and it keeps the exact
versions the build resolved rather than re-resolving ranges at package time.

The working-directory rule is unchanged but moves with the tree: `node_modules`
is now inside `server/`, so that is where the process has to start. Running it
from `.output` gives the same silent failure as before — HTTP 200, complete
email, no styles.
