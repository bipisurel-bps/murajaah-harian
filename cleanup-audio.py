#!/usr/bin/env python3
"""
Murajaah Harian — Audio retention & archival script.

Behavior (configurable via env vars):
  RETENTION_DAYS  : keep hot audio for N days (default 14)
  ARCHIVE_REMOTE  : rclone remote:path to move old audio to before cleanup
                    (empty = skip archival, just delete after retention)

Age is determined by the AUDIO FILE's modification time (mtime), which is
reliable regardless of the DB 'tgl' format.

Flow:
  1. Find logs with audio older than RETENTION_DAYS.
  2. If ARCHIVE_REMOTE set, move the file there (rclone move).
  3. Otherwise delete the local file.
  4. Set logs.audio_path = NULL (keep setoran history, free disk).

Run manually:  RETENTION_DAYS=14 python3 cleanup-audio.py
"""
import os
import sqlite3
import subprocess
import sys
import time

DB = '/home/ubuntu/murajaah-harian/tahfiz.db'
UPLOADS = '/home/ubuntu/murajaah-harian/public/uploads'
RETENTION_DAYS = int(os.environ.get('RETENTION_DAYS', '14'))
ARCHIVE_REMOTE = os.environ.get('ARCHIVE_REMOTE', '').strip()

cutoff_ts = time.time() - (RETENTION_DAYS * 86400)

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, audio_path FROM logs WHERE audio_path IS NOT NULL AND audio_path != ''"
).fetchall()

deleted = archived = errors = 0

for r in rows:
    rel = r['audio_path'].lstrip('/')
    full = os.path.join(UPLOADS, os.path.basename(rel))

    if not os.path.exists(full):
        # file already gone — just null the reference
        conn.execute("UPDATE logs SET audio_path = NULL WHERE id = ?", (r['id'],))
        continue

    # only touch files older than retention window
    try:
        mtime = os.path.getmtime(full)
    except OSError:
        continue
    if mtime >= cutoff_ts:
        continue  # still within retention window

    try:
        if ARCHIVE_REMOTE:
            dest = ARCHIVE_REMOTE.rstrip('/') + '/uploads/' + os.path.basename(rel)
            p = subprocess.run(
                ['rclone', 'moveto', full, dest],
                capture_output=True, text=True, timeout=300
            )
            if p.returncode == 0:
                archived += 1
                conn.execute("UPDATE logs SET audio_path = NULL WHERE id = ?", (r['id'],))
            else:
                errors += 1
                print(f"[ARCHIVE-ERR] log {r['id']}: {p.stderr.strip()[:200]}", file=sys.stderr)
        else:
            os.remove(full)
            deleted += 1
            conn.execute("UPDATE logs SET audio_path = NULL WHERE id = ?", (r['id'],))
    except Exception as e:
        errors += 1
        print(f"[ERR] log {r['id']}: {e}", file=sys.stderr)

conn.commit()
conn.close()

print(f"cleanup done | retention={RETENTION_DAYS}d | archived={archived} | deleted={deleted} | errors={errors}")
