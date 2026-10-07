# The packaging that survives, and the one that does not.
#
# The tempting shape is to let Nitro trace, delete the packages it got wrong,
# and copy the real ones in from the builder's node_modules. `pnpm stub-replace`
# in this repo runs exactly that, and README.md records how far it gets: past
# rolldown's native binding, into lightningcss's, into @vue/compiler-sfc, and
# then into a version collision no amount of copying resolves. Nitro's traced
# tree is flat, with conflicting versions parked in `.nitro/<name>@<version>`
# and reachable only from the imports Nitro rewrote. A hand-copied package gets
# none of that rewiring, so it binds to whichever version won the flat slot.
#
# What works is not patching the traced tree but replacing it: drop the
# mis-traced packages and do a real, flat install of the externals inside
# .output, where Node finds them walking up from server/.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drops the mis-traced packages and runs `npm install` of the externals into
# .output. npm rather than a copied pnpm tree: pnpm links each package to a
# store and keeps its dependencies beside it there, so copying that tree with
# symlinks dereferenced flattens it apart and packages stop seeing their own
# neighbours. A flat install has no links leaving the tree, so it relocates.
RUN pnpm vendor

FROM node:24-bookworm-slim AS runtime

# The build and runtime images must share a libc. Only the binding matching the
# build machine is ever installed, so a glibc build stage feeding an Alpine
# runtime has no binding to find, however the packaging is arranged.
WORKDIR /app
COPY --from=builder /app/.output ./.output

# Not /app. Maizzle resolves @maizzle/tailwindcss itself at runtime, relative
# to process.cwd(), outside the import graph entirely — nothing in the app's
# source names it. Get this wrong and the server answers HTTP 200 with a
# complete, well-formed email carrying no styles at all; the only trace is
# `Can't resolve '@maizzle/tailwindcss'` in the log.
WORKDIR /app/.output

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.mjs"]
