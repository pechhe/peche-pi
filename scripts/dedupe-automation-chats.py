#!/usr/bin/env python3
"""One-off: remove duplicate automation chats spawned by the scheduler double-fire bug.

Scope: today's (2026-06-09) non-archived spawn of these automations only:
  ⚡ Fallow Fix, ⚡ Improve architecture, ⚡ Codex changelog scan
Keeps the session with the LARGEST transcript per group (most complete run),
deletes the rest (catalog entry + sessionFiles map + transcript file + attachments).

Refuses to run while Peche Pi is alive (the app owns catalogs.json and writes it
atomically; editing it live corrupts/loses changes).

Dry-run by default. Pass --apply to actually delete.
"""
import json, os, sys, subprocess, collections, shutil, time

SUPPORT = os.path.expanduser("~/Library/Application Support/Peche Pi")
CATALOG = os.path.join(SUPPORT, "catalogs.json")
ATTACH = os.path.join(SUPPORT, "attachments")
DATE = "2026-06-09"
TARGETS = {"⚡ Fallow Fix", "⚡ Improve architecture", "⚡ Codex changelog scan"}
APPLY = "--apply" in sys.argv

def app_alive():
    out = subprocess.run(["pgrep", "-f", "release-dev/mac-arm64/Peche Pi"],
                         capture_output=True, text=True).stdout.strip()
    return bool(out)

def main():
    if app_alive():
        print("ABORT: Peche Pi is running. Quit it first (Cmd-Q), then re-run.")
        sys.exit(1)

    d = json.load(open(CATALOG))
    sf = d["sessionFiles"]

    groups = collections.defaultdict(list)
    for s in d["sessions"]:
        t = s.get("title", "")
        if t in TARGETS and (s.get("updatedAt") or "").startswith(DATE) and not s.get("archivedAt"):
            sid = s["sessionRef"]["sessionId"]
            key = f'{s["workspaceId"]}:{sid}'
            fp = sf.get(key)
            sz = os.path.getsize(fp) if fp and os.path.exists(fp) else -1
            groups[t].append({"sid": sid, "key": key, "fp": fp, "sz": sz})

    delete_keys, delete_sids = set(), set()
    for t, items in groups.items():
        items.sort(key=lambda x: x["sz"], reverse=True)
        keep = items[0]
        print(f"\n== {t}: keep {keep['sid'][:12]} ({keep['sz']} bytes), delete {len(items)-1}")
        for it in items[1:]:
            print(f"   DEL {it['sid'][:12]} ({it['sz']} bytes)")
            delete_keys.add(it["key"]); delete_sids.add(it["sid"])

    if not delete_keys:
        print("\nNothing to delete."); return
    print(f"\nTOTAL delete: {len(delete_keys)} sessions")

    if not APPLY:
        print("\nDRY RUN. Re-run with --apply to execute."); return

    # backup
    bdir = os.path.join(SUPPORT, f"_dedupe_backup_apply_{int(time.time())}")
    os.makedirs(bdir, exist_ok=True)
    shutil.copy2(CATALOG, os.path.join(bdir, "catalogs.json"))
    print(f"backup -> {bdir}")

    # collect transcript files to remove before mutating sf
    transcript_files = [sf[k] for k in delete_keys if k in sf and sf[k]]

    d["sessions"] = [s for s in d["sessions"]
                     if f'{s["workspaceId"]}:{s["sessionRef"]["sessionId"]}' not in delete_keys]
    for k in delete_keys:
        sf.pop(k, None)

    # atomic write (match store: 2-space indent + trailing newline)
    tmp = f"{CATALOG}.dedupe.{os.getpid()}.tmp"
    open(tmp, "w").write(json.dumps(d, indent=2) + "\n")
    os.replace(tmp, CATALOG)
    print("catalogs.json rewritten")

    for fp in transcript_files:
        if fp and os.path.exists(fp):
            os.remove(fp); print("rm transcript", os.path.basename(fp))

    if os.path.isdir(ATTACH):
        for name in os.listdir(ATTACH):
            if any(sid in name for sid in delete_sids):
                p = os.path.join(ATTACH, name)
                shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
                print("rm attachment", name)

    print("\nDONE. Reopen Peche Pi to verify.")

if __name__ == "__main__":
    main()
