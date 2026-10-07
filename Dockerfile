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
# What works is to stop treating the traced tree as something to repair.
# Nitro's own `.output/server/package.json` already names every dependency the
# bundle needs at an exact version; the manifest is right and only the install
# beside it is wrong. So `pnpm vendor-server` deletes the tree outright and has
# npm build that manifest into an empty directory, which is an ordinary problem.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# npm rather than a copied pnpm tree: pnpm links each package to a store and
# keeps its dependencies beside it there, so copying that tree with symlinks
# dereferenced flattens it apart and packages stop seeing their own neighbours.
# A fresh install has no links leaving the tree, so it relocates into an image.
RUN pnpm vendor-server

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
