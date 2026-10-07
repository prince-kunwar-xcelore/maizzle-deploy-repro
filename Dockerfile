# The packaging that survives, and the one that does not.
#
# The tempting shape is to let Nitro trace, delete the packages it got wrong,
# and copy the real ones in from the builder's node_modules. `pnpm stub-replace`
# runs exactly that, and README.md records how far it gets: past rolldown's
# native binding, into lightningcss's, into @vue/compiler-sfc, and then into a
# version collision no amount of copying resolves. Nitro's tree is a symlink
# farm in pnpm's style — top-level entries pointing into `.nitro/<name>@<version>`,
# second versions nested — and a hand-copied package arrives outside all of
# that, binding whichever version the symlink happens to point at.
#
# Layering `npm install` over that tree is not the answer either: arborist
# cannot read the symlink farm as a node_modules layout and aborts before
# installing anything, with `Cannot read properties of null (reading 'fsTop')`.
#
# Both of those treat the traced tree as something to fix after the fact. The
# tracer is not wrong about how to copy a package; it is blind to a handful of
# things nothing imports — a native binding chosen by a runtime platform
# branch, an `import.meta.resolve`, a stylesheet pulled in by enhanced-resolve
# mid-render. Nitro takes a list of those: `externals.traceInclude`, in
# nuxt.config.ts, where the reason for each entry can sit next to it.
#
# What that does not cover is CSS. A `.css` entry point makes Rollup answer
# the resolve with a virtual `\0raw:` id and the build dies, so the two
# stylesheet packages are copied in a `compiled` hook instead. Copying CSS is
# safe in the way copying a package is not: no dependency closure, nothing to
# resolve against its new neighbours.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# No packaging step. nuxt.config.ts names what the tracer cannot see through
# `externals.traceInclude`, so the trace comes out complete and `.output` is
# already correct — 109M, against 262M for rebuilding the tree from Nitro's
# manifest and 304M for installing the externals alongside it.
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

# The build and runtime images must share a libc. Only the binding matching the
# build machine is ever installed, so a glibc build stage feeding an Alpine
# runtime has no binding to find, however the packaging is arranged.
WORKDIR /app
COPY --from=builder /app/.output ./.output

# Where node_modules now lives, and not negotiable. Maizzle resolves
# @maizzle/tailwindcss itself at runtime, relative to process.cwd(), outside
# the import graph entirely — nothing in the app's source names it. Get this
# wrong and the server answers HTTP 200 with a complete, well-formed email
# carrying no styles at all; the only trace is a line in the log reading
# `Can't resolve '@maizzle/tailwindcss'`.
WORKDIR /app/.output/server

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.mjs"]
