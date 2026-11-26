#!/bin/sh
# Vercel "Ignored Build Step" (vercel.json): exiting 0 skips the build, 1 builds.
# A picture collected by the browser extension waits in the inbox, off the site, so its commit
# ("inspair: collect …") needs no deploy; the commit that files it builds the site as usual.
case "$VERCEL_GIT_COMMIT_MESSAGE" in
  "inspair: collect "*) echo "Only the inbox changed: no build needed."; exit 0 ;;
esac
exit 1
