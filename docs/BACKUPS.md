# Backups and restore (Super Admin → Backups)

SampTrek copies the **whole database** (every organisation, project, respondent, invoice and setting)
with MongoDB's own free `mongodump`, keeps the copies where you choose, and can put any of them back.
Only the **Super Admin** sees it, at **Super Admin → Backups** (`/super-admin/backups`).

## 1. Choose where backups are kept (in the app)

**Settings → Integrations → Backups → Backup storage.** Like every integration, it is set up in the
app, not on the server. Only the organisation that runs the server sees it.

| Keep backups in | Cost | Good for |
| --- | --- | --- |
| A folder on this server (default `apps/api/backups`) | Free | Getting started. If the server is lost, the backups go with it, so download one now and then. |
| Cloudflare R2 bucket | Free up to 10 GB | Recommended. Off the server, no fee for downloads. |
| Backblaze B2 bucket | Free up to 10 GB | Same idea. |
| MinIO, Wasabi, AWS S3 or any S3-compatible bucket | Your own | Any S3 API works (path or virtual-hosted addresses). |

Fields: target, folder, bucket endpoint, region, bucket, folder in the bucket, address style, access
key and secret, and an **encryption passphrase**. The card has step-by-step help for R2 and B2.
**Test** writes, reads and deletes a small file and checks that `mongodump` is installed.

**Encryption (recommended).** With a passphrase every backup is encrypted with AES-256-GCM (key from
the passphrase with scrypt). Keep the passphrase in your password manager: a backup cannot be restored
on a new server without it. Changing the passphrase only affects new backups; to restore an older one,
enter the passphrase it was made with. The passphrase is stored encrypted like every integration secret.

S3 requests are signed in SampTrek itself (AWS Signature Version 4), so no SDK needs installing.

## 2. Take backups

- **Back up now** takes one at once (it runs in the background; the list updates by itself).
- **Schedule**: every day or every week at an hour (UTC). The server checks every five minutes.
- **Keep the newest N** (default 14): after each new backup the older ones are deleted from the
  storage. Failed attempts stay in the list for 30 days so you can see why.
- **Email me if a backup fails** emails the Super Admins (through the server owner's email settings).

Each backup is a gzip-compressed `mongodump` archive (`samptrek-20261108T0300Z-a1b2c3.dump`, `.enc`
when encrypted) with a small `.json` manifest next to it: when, who, size, SHA-256 fingerprint, the
database version (the schema version, `SCHEMA_VERSION` in `apps/api/src/prisma/indexes.ts`; the manifest
field is still called `migration`) and the number of collections (`tables`). Documents of the backup
list itself and of the uptime history are not inside a backup, so a restore never loses them.

The page warns when backups are not encrypted, when they sit on the same server, when the last good
backup is more than a week old, and when `mongodump` is missing.

## 3. Check a backup

- **Test** fetches the file, compares its fingerprint, decrypts it and reads the archive's list of
  collections. The database is not touched.
- **Download** gives the file as stored (encrypted if it was made encrypted). **Plain** gives the
  decrypted archive, ready for `mongorestore --archive --gzip`; keep it safe.
- **Find backups in storage** reads the manifests in the storage and adds any backup the list does not
  know. Use it on a new server, or after restoring with the command line.

## 4. Restore (guarded)

**Restore** on a backup opens a dialog that says exactly what will happen. To go ahead the Super Admin
types **RESTORE** and their own password. Then, in the background, with progress on the page:

1. **Safety backup** of the database as it is right now (listed as "Safety copy before a restore").
   If it fails, nothing else happens.
2. **Fetch** the backup and check its **fingerprint**: a file changed since it was made is refused.
3. **Decrypt** it and read it through.
4. **Replace the database**: MongoDB cannot do this in one transaction, so the restore first makes
   a local copy of the database as it is, then empties it and loads the backup with `mongorestore`
   (`--stopOnError`). If loading fails, the database is emptied again and the local copy is put back:
   it either works completely or ends as it was.
5. **This version's collections and indexes** are then set up (as `pnpm db:deploy` does). A backup
   from a *newer* SampTrek version (a higher schema version) is refused until the server is updated.

The backup list, the uptime history, the backup storage settings and the backup schedule are kept as
they are now, so the safety copy from step 1 is always there to undo the restore. Everything else goes
back to the backup's moment: projects, users, every other setting. People stay signed in when their
account exists in the backup. The restore is written to the server owner's activity log.

Only one backup or restore runs at a time.

## 5. When the app cannot start: the command line

On the server, in the SampTrek folder:

```bash
pnpm backup                                          # one backup to the storage set in the app
pnpm restore-backup --file /path/samptrek-….dump.enc # asks for the passphrase and for RESTORE
pnpm restore-backup --file backup.dump --yes         # no prompts (BACKUP_PASSPHRASE for .enc)
pnpm restore-backup --decrypt backup.dump.enc --out plain.dump
```

`pnpm backup` also suits a server cron job if you prefer one to the in-app schedule. The restore is the
same all-or-nothing restore as in the app. Afterwards open Super Admin → Backups and press **Find
backups in storage**.

Without SampTrek at all, a plain archive restores with MongoDB's tools (then run `pnpm db:deploy`):
`mongorestore --uri "$DATABASE_URL" --archive=plain.dump --gzip --drop`.

## Server requirements

- The MongoDB Database Tools 100.x (`mongodump`, `mongorestore`): the `mongodb-database-tools`
  package from MongoDB's repository, or the download from mongodb.com unpacked anywhere. If they are
  not on the PATH, set `MONGO_TOOLS_DIR=/path/to/mongodb-database-tools/bin`. The database address is
  given to the tools in a private temporary config file, so the password never shows in the process list.
- Optional: `BACKUP_TMP_DIR` for the temporary files a backup needs (default: the system temp folder).
  It needs free space of about three times the backup size (a restore keeps a local copy of the database).
- The database user needs read and write on the database, and to create and drop its collections (the `dbOwner` role), to restore.
- Keep a safe copy of `MFA_ENCRYPTION_KEY`: saved integration secrets in a restored database can only
  be read with the same key.
- Fallback for servers set up before this: `BACKUP_TARGET`, `BACKUP_DIR`, `BACKUP_S3_*` and
  `BACKUP_PASSPHRASE` in the environment are used while nothing is saved in the app.
- `BACKUP_SCHEDULER_ENABLED=false` turns the schedule off on a server (tests do this).

## API (Super Admin only)

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/v1/super-admin/backups` | Settings, storage, tool check, running state, restore progress, list |
| PUT | `/api/v1/super-admin/backups/settings` | `{ schedule: off|daily|weekly, hour, weekday, keep, notifyOnFailure }` |
| POST | `/api/v1/super-admin/backups` | Start a backup (202) |
| POST | `/api/v1/super-admin/backups/rescan` | Find backups in storage |
| POST | `/api/v1/super-admin/backups/:id/verify` | Test a backup |
| GET | `/api/v1/super-admin/backups/:id/download[?plain=1]` | Download |
| POST | `/api/v1/super-admin/backups/:id/restore` | `{ confirm: "RESTORE", password }`, starts the restore (202) |
| DELETE | `/api/v1/super-admin/backups/:id` | Delete a backup and its file |

Code: `apps/api/src/backups/` (`backup-core.ts` database and encryption, `storage.ts` folder and S3,
`backups.service.ts` the screen, schedule and restore), CLI `apps/api/prisma/backup-cli.ts`.
