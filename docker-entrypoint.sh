#!/bin/sh
set -e

# ============================================================
# Bansil Books — Docker Entrypoint
# Secure privilege-drop pattern for Render persistent disk
#
# V4 DATABASE ACTIVATION: One-shot atomic database swap with
# integrity verification, ordered rollback, mismatch detection,
# and permission preservation.
#
# 14 Requirements addressed:
#  1. Activate only when both approved .new files exist
#  2. Reject partial or unexpected activation state
#  3. Verify both expected SHA-256 hashes
#  4. Run SQLite integrity and foreign-key checks
#  5. Preserve consistent staging backups
#  6. No other process accesses databases during activation
#  7. Handle old WAL/SHM safely
#  8. Activate both databases as one controlled operation
#  9. Roll back both databases on partial failure
# 10. Preserve permissions and ownership
# 11. Verify activated databases before startup
# 12. Make repeated startup safe and idempotent
# 13. Never silently start with mismatched databases
# 14. Preserve all recovery artifacts
# ============================================================

mkdir -p /app/data
chown -R nextjs:nodejs /app/data

# ============================================================
# MISMATCH DETECTION (Requirement 13)
#
# Before any activation logic, detect inconsistent state:
# exactly one .new file present means partial transfer or
# incomplete prior cleanup. Log prominently and refuse to
# activate. App starts with whatever databases exist.
# ============================================================
BB_NEW=0
AW_NEW=0
[ -f /app/data/bansil_books.db.new ] && BB_NEW=1
[ -f /app/data/audit_workspace.db.new ] && AW_NEW=1

if [ "$BB_NEW" -ne "$AW_NEW" ]; then
  echo "========================================="
  echo "  WARNING: PARTIAL .new STATE DETECTED"
  echo "========================================="
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "bansil_books.db.new:    exists=$BB_NEW"
  echo "audit_workspace.db.new: exists=$AW_NEW"
  echo ""
  echo "This indicates a partial transfer or incomplete"
  echo "prior activation. REFUSING to activate."
  echo "Investigate and re-transfer before deploying."
  echo ""
  echo "Current /app/data contents:"
  ls -la /app/data/ 2>/dev/null || true
  echo ""
  echo "App will start with current databases."
  echo "========================================="
  echo ""
fi

# ============================================================
# V4 DATABASE ACTIVATION (one-shot)
#
# Guard: ONLY runs when BOTH .new files exist (Req 1).
# After success, .new files are gone — block is a permanent
# no-op on all subsequent startups (Req 12).
#
# On ANY failure: rolls back, logs error, starts app with
# previous databases. The app ALWAYS starts.
#
# Tools: sha256sum (busybox), node 22+ with node:sqlite
# ============================================================
if [ "$BB_NEW" -eq 1 ] && [ "$AW_NEW" -eq 1 ]; then

  echo "=== V4 DATABASE ACTIVATION ==="
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Disable set -e: activation handles all errors explicitly.
  # The app MUST start regardless of activation outcome.
  set +e

  FAIL=""

  # ---- Pre-check: Unexpected state detection (Req 2) ----
  echo ""
  echo "--- Pre-check: Activation State ---"
  BB_PRE=0
  AW_PRE=0
  [ -e /app/data/bansil_books.db.pre-v4 ] && BB_PRE=1
  [ -e /app/data/audit_workspace.db.pre-v4 ] && AW_PRE=1

  if [ "$BB_PRE" -eq 1 ] || [ "$AW_PRE" -eq 1 ]; then
    echo "FATAL: Residual .pre-v4 files detected alongside .new files."
    echo "  bansil_books.db.pre-v4:    exists=$BB_PRE"
    echo "  audit_workspace.db.pre-v4: exists=$AW_PRE"
    echo "A prior activation attempt may have failed midway."
    echo "Manual investigation required before retry."
    FAIL="residual_pre_v4"
  else
    echo "No residual .pre-v4 files — clean activation state."
  fi

  # Log presence of residual .failed-v4 (informational only)
  if [ -z "$FAIL" ]; then
    if [ -f /app/data/bansil_books.db.failed-v4 ] || \
       [ -f /app/data/audit_workspace.db.failed-v4 ]; then
      echo "NOTE: Residual .failed-v4 files from prior attempt detected."
      echo "  Proceeding with fresh activation."
    fi
  fi

  # Expected SHA-256 hashes (from verified SCP transfer)
  EXPECTED_BB="8667464822da503868116af50e649827744ff9781f753415a206a47b8ec0dacc"
  EXPECTED_AW="4dd6a10bf6dc22ec0366d2cd110c819db80a79ec486be3a57582aba80a5d1ca6"

  # ---- Step 1/9: SHA-256 Hash Verification (Req 3) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 1/9: SHA-256 Hash Verification ---"
    HASH_BB=$(sha256sum /app/data/bansil_books.db.new | awk '{print $1}')
    HASH_AW=$(sha256sum /app/data/audit_workspace.db.new | awk '{print $1}')

    if [ "$HASH_BB" != "$EXPECTED_BB" ]; then
      echo "FATAL: bansil_books.db.new hash MISMATCH"
      echo "  Expected: $EXPECTED_BB"
      echo "  Got:      $HASH_BB"
      FAIL="hash_mismatch_bb"
    elif [ "$HASH_AW" != "$EXPECTED_AW" ]; then
      echo "FATAL: audit_workspace.db.new hash MISMATCH"
      echo "  Expected: $EXPECTED_AW"
      echo "  Got:      $HASH_AW"
      FAIL="hash_mismatch_aw"
    else
      echo "bansil_books.db.new:    MATCH"
      echo "audit_workspace.db.new: MATCH"
    fi
  fi

  # ---- Step 2/9: SQLite Integrity Check (Req 4) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 2/9: SQLite Integrity Check (.new) ---"
    node --no-warnings --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db1 = new DatabaseSync('/app/data/bansil_books.db.new', { readOnly: true });
const r1 = db1.prepare('PRAGMA integrity_check').get();
db1.close();
const db2 = new DatabaseSync('/app/data/audit_workspace.db.new', { readOnly: true });
const r2 = db2.prepare('PRAGMA integrity_check').get();
db2.close();
const v1 = String(Object.values(r1)[0]);
const v2 = String(Object.values(r2)[0]);
if (v1 !== 'ok' || v2 !== 'ok') {
  console.error('INTEGRITY FAIL: bb=' + v1 + ' aw=' + v2);
  process.exit(1);
}
console.log('bansil_books.db.new:    integrity_check = ok');
console.log('audit_workspace.db.new: integrity_check = ok');
"
    if [ $? -ne 0 ]; then
      FAIL="integrity_check_new"
    fi
  fi

  # ---- Step 3/9: Foreign Key Check (Req 4) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 3/9: Foreign Key Check (.new) ---"
    node --no-warnings --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db1 = new DatabaseSync('/app/data/bansil_books.db.new', { readOnly: true });
const fk1 = db1.prepare('PRAGMA foreign_key_check').all();
db1.close();
const db2 = new DatabaseSync('/app/data/audit_workspace.db.new', { readOnly: true });
const fk2 = db2.prepare('PRAGMA foreign_key_check').all();
db2.close();
if (fk1.length > 0 || fk2.length > 0) {
  console.error('FK FAIL: bb=' + fk1.length + ' aw=' + fk2.length);
  process.exit(1);
}
console.log('bansil_books.db.new:    foreign_key_check = 0 violations');
console.log('audit_workspace.db.new: foreign_key_check = 0 violations');
"
    if [ $? -ne 0 ]; then
      FAIL="foreign_key_check_new"
    fi
  fi

  # ---- Step 4/9: Clean WAL/SHM from .new files (Req 7) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 4/9: Clean .new WAL/SHM ---"
    rm -f /app/data/bansil_books.db.new-wal \
          /app/data/bansil_books.db.new-shm \
          /app/data/audit_workspace.db.new-wal \
          /app/data/audit_workspace.db.new-shm
    echo "Cleaned (safety)"
  fi

  # ---- Step 5/9: Checkpoint current databases (Req 7) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 5/9: Checkpoint Current Databases ---"
    node --no-warnings --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
function checkpoint(path, name) {
  try {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('PRAGMA journal_mode = DELETE');
    db.close();
    console.log(name + ': checkpointed, journal_mode = DELETE');
  } catch(e) {
    console.log(name + ': checkpoint skipped (' + e.message + ')');
  }
}
checkpoint('/app/data/bansil_books.db', 'bansil_books.db');
checkpoint('/app/data/audit_workspace.db', 'audit_workspace.db');
"
    rm -f /app/data/bansil_books.db-wal \
          /app/data/bansil_books.db-shm \
          /app/data/audit_workspace.db-wal \
          /app/data/audit_workspace.db-shm
    echo "WAL/SHM cleaned"
  fi

  # ---- Step 6/9: Back up current databases (Req 5, 14) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 6/9: Back Up Current Databases ---"
    if [ -f /app/data/bansil_books.db ]; then
      mv /app/data/bansil_books.db /app/data/bansil_books.db.pre-v4
      if [ $? -ne 0 ]; then
        echo "FATAL: mv bansil_books.db -> .pre-v4 failed"
        FAIL="backup_bb"
      else
        echo "bansil_books.db -> bansil_books.db.pre-v4"
      fi
    else
      echo "bansil_books.db: not present (first deploy)"
    fi
    if [ -z "$FAIL" ] && [ -f /app/data/audit_workspace.db ]; then
      mv /app/data/audit_workspace.db /app/data/audit_workspace.db.pre-v4
      if [ $? -ne 0 ]; then
        echo "FATAL: mv audit_workspace.db -> .pre-v4 failed"
        # Restore the first backup
        mv /app/data/bansil_books.db.pre-v4 /app/data/bansil_books.db 2>/dev/null
        FAIL="backup_aw"
      else
        echo "audit_workspace.db -> audit_workspace.db.pre-v4"
      fi
    else
      if [ -z "$FAIL" ]; then
        echo "audit_workspace.db: not present (first deploy)"
      fi
    fi
  fi

  # ---- Step 7/9: Activate .new -> active (Req 8, 9) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 7/9: Activate V4 Databases ---"
    mv /app/data/bansil_books.db.new /app/data/bansil_books.db
    if [ $? -ne 0 ]; then
      echo "FATAL: mv bansil_books.db.new -> active failed"
      # Restore pre-v4 backups
      mv /app/data/bansil_books.db.pre-v4 /app/data/bansil_books.db 2>/dev/null
      mv /app/data/audit_workspace.db.pre-v4 /app/data/audit_workspace.db 2>/dev/null
      FAIL="mv_bb"
    else
      echo "bansil_books.db.new -> bansil_books.db"
      mv /app/data/audit_workspace.db.new /app/data/audit_workspace.db
      if [ $? -ne 0 ]; then
        echo "FATAL: mv audit_workspace.db.new -> active failed"
        # Restore both: reverse the first mv, then restore pre-v4
        mv /app/data/bansil_books.db /app/data/bansil_books.db.new 2>/dev/null
        mv /app/data/bansil_books.db.pre-v4 /app/data/bansil_books.db 2>/dev/null
        mv /app/data/audit_workspace.db.pre-v4 /app/data/audit_workspace.db 2>/dev/null
        FAIL="mv_aw"
      else
        echo "audit_workspace.db.new -> audit_workspace.db"
      fi
    fi
  fi

  # ---- Step 8/9: Fix permissions (Req 10) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 8/9: Fix Permissions ---"
    chown nextjs:nodejs /app/data/bansil_books.db \
                        /app/data/audit_workspace.db
    if [ $? -ne 0 ]; then
      echo "WARNING: chown failed — app may have permission issues"
    else
      echo "Ownership set: nextjs:nodejs"
    fi
    # Ensure backups also have correct ownership
    chown nextjs:nodejs /app/data/bansil_books.db.pre-v4 \
                        /app/data/audit_workspace.db.pre-v4 2>/dev/null || true
  fi

  # ---- Step 9/9: Post-activation verification (Req 11) ----
  if [ -z "$FAIL" ]; then
    echo ""
    echo "--- Step 9/9: Post-Activation Verification ---"
    node --no-warnings --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db1 = new DatabaseSync('/app/data/bansil_books.db', { readOnly: true });
const r1 = db1.prepare('PRAGMA integrity_check').get();
db1.close();
const db2 = new DatabaseSync('/app/data/audit_workspace.db', { readOnly: true });
const r2 = db2.prepare('PRAGMA integrity_check').get();
db2.close();
const v1 = String(Object.values(r1)[0]);
const v2 = String(Object.values(r2)[0]);
if (v1 !== 'ok' || v2 !== 'ok') {
  console.error('POST-ACTIVATION INTEGRITY FAIL: bb=' + v1 + ' aw=' + v2);
  process.exit(1);
}
console.log('bansil_books.db:    integrity_check = ok');
console.log('audit_workspace.db: integrity_check = ok');
"
    if [ $? -ne 0 ]; then
      echo "ROLLING BACK: post-activation integrity failed"
      mv /app/data/bansil_books.db /app/data/bansil_books.db.failed-v4 2>/dev/null
      mv /app/data/audit_workspace.db /app/data/audit_workspace.db.failed-v4 2>/dev/null
      mv /app/data/bansil_books.db.pre-v4 /app/data/bansil_books.db 2>/dev/null
      mv /app/data/audit_workspace.db.pre-v4 /app/data/audit_workspace.db 2>/dev/null
      FAIL="post_integrity"
    fi
  fi

  # ---- Activation Result ----
  echo ""
  if [ -z "$FAIL" ]; then
    echo "========================================="
    echo "  V4 DATABASE ACTIVATION: SUCCESS"
    echo "========================================="
    echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "Active databases:"
    ls -la /app/data/bansil_books.db /app/data/audit_workspace.db
    echo ""
    echo "Pre-V4 backups preserved at:"
    ls -la /app/data/bansil_books.db.pre-v4 \
           /app/data/audit_workspace.db.pre-v4 2>/dev/null || echo "  (none — first deploy)"
    echo ""
    echo "Transfer backups preserved at:"
    ls -la /app/data/backup/bansil_books.db.bak \
           /app/data/backup/audit_workspace.db.bak 2>/dev/null || echo "  (none)"
  else
    echo "========================================="
    echo "  V4 DATABASE ACTIVATION: FAILED"
    echo "  Reason: $FAIL"
    echo "========================================="
    echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "App will start with previous databases."
    echo ""
    echo "Current database state:"
    ls -la /app/data/*.db 2>/dev/null || echo "  (no databases found)"
    echo ""
    echo "Recovery artifacts:"
    ls -la /app/data/*.pre-v4 /app/data/*.failed-v4 \
           /app/data/*.new 2>/dev/null || echo "  (none)"
  fi
  echo ""

  # Re-enable set -e for the privilege drop
  set -e
fi

# Drop privileges permanently and exec the application.
exec su-exec nextjs "$@"
