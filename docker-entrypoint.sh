#!/bin/sh
# ============================================================
# Bansil Books — Docker Entrypoint
# Secure privilege-drop pattern for Render persistent disk
#
# Starts as root to fix /app/data ownership, then permanently
# drops to the unprivileged 'nextjs' user via su-exec.
# ============================================================
set -e

# Ensure persistent data directory exists (handles both
# build-time placeholder and Render-mounted persistent disk)
mkdir -p /app/data

# Set ownership so the application user can read/write
# SQLite databases and token files on the persistent disk.
# Only touches /app/data — no other application directories.
chown -R nextjs:nodejs /app/data

# Drop privileges permanently and exec the application.
# exec replaces this shell so signals (SIGTERM, SIGINT)
# reach the Node process directly for clean shutdown.
exec su-exec nextjs "$@"
