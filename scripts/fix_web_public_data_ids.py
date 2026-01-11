import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


def is_numeric_folder(name: str) -> bool:
    return name.isdigit() and name != ""


def canonical_id(name: str) -> str:
    # "008" -> "8", "000" -> "0"
    try:
        return str(int(name))
    except ValueError:
        return name


@dataclass(frozen=True)
class FolderStats:
    name: str
    path: Path
    has_suffix: bool
    has_prefix: bool
    file_count: int
    total_bytes: int
    newest_mtime: float

    @property
    def score(self) -> int:
        # Primary: presence of index files
        score = 0
        score += 1_000_000 if self.has_suffix else 0
        score += 1_000_000 if self.has_prefix else 0
        # Secondary: total bytes and file count
        score += min(self.total_bytes, 2_000_000_000)  # cap so it doesn't dominate
        score += self.file_count
        return score

    def newest_mtime_iso(self) -> str:
        if self.newest_mtime <= 0:
            return "-"
        return datetime.fromtimestamp(self.newest_mtime).isoformat(sep=" ", timespec="seconds")


def compute_stats(folder: Path) -> FolderStats:
    has_suffix = (folder / "patterns.json").exists()
    has_prefix = (folder / "patterns_prefix.json").exists()

    file_count = 0
    total_bytes = 0
    newest_mtime = 0.0

    # Walk files; avoid following junctions
    for root, dirs, files in os.walk(folder):
        # skip hidden/system-ish dirs if any
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fn in files:
            try:
                p = Path(root) / fn
                st = p.stat()
            except OSError:
                continue
            file_count += 1
            total_bytes += int(st.st_size)
            newest_mtime = max(newest_mtime, float(st.st_mtime))

    return FolderStats(
        name=folder.name,
        path=folder,
        has_suffix=has_suffix,
        has_prefix=has_prefix,
        file_count=file_count,
        total_bytes=total_bytes,
        newest_mtime=newest_mtime,
    )


def run_robocopy_missing_only(src: Path, dst: Path) -> int:
    # Copy only files that do not exist in destination.
    # /XC /XN /XO skips changed/newer/older files; missing files still copy.
    cmd = [
        "robocopy",
        str(src),
        str(dst),
        "/E",
        "/XC",
        "/XN",
        "/XO",
        "/R:2",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP",
    ]
    completed = subprocess.run(cmd)
    return int(completed.returncode)


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("web/public/data"),
        help="Root folder containing numeric country folders",
    )
    parser.add_argument(
        "--backup-root",
        type=Path,
        default=Path("web/public/_data_backup_zero_prefixed"),
        help="Where to move eliminated zero-prefixed folders",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (otherwise dry-run)",
    )

    args = parser.parse_args()
    root = args.root.resolve()
    backup_root = args.backup_root.resolve()

    if not root.exists() or not root.is_dir():
        print(f"[error] root not found: {root}")
        return 2

    # Collect numeric directories
    dirs = [d for d in root.iterdir() if d.is_dir() and is_numeric_folder(d.name)]

    groups: dict[str, list[FolderStats]] = {}
    for d in dirs:
        cid = canonical_id(d.name)
        groups.setdefault(cid, []).append(compute_stats(d))

    # Find duplicates and leading-zero folders
    duplicate_groups = {cid: lst for cid, lst in groups.items() if len(lst) > 1}
    zero_prefixed = [st for lst in groups.values() for st in lst if st.name.startswith("0") and st.name != "0"]

    print(f"[info] root: {root}")
    print(f"[info] numeric folders: {len(dirs)}")
    print(f"[info] leading-zero folders: {len(zero_prefixed)}")
    print(f"[info] duplicate canonical ids: {len(duplicate_groups)}")

    # Plan actions
    actions: list[tuple[str, FolderStats, str, Path]] = []
    # (action, src_stats, dest_name, dest_path)

    for cid, lst in sorted(duplicate_groups.items(), key=lambda x: int(x[0]) if x[0].isdigit() else x[0]):
        # Prefer destination folder already named as canonical (no leading zeros)
        canonical_name = cid
        exact = next((s for s in lst if s.name == canonical_name), None)
        if exact is not None:
            dest = exact
        else:
            # Pick best by score
            dest = max(lst, key=lambda s: (s.score, s.newest_mtime))

        dest_path = root / canonical_name

        # If chosen dest isn't canonical-named and canonical doesn't exist, rename chosen dest to canonical
        if dest.name != canonical_name and not dest_path.exists():
            actions.append(("rename_to_canonical", dest, canonical_name, dest_path))

        # Merge everything else into canonical destination
        for s in lst:
            if s.name == dest.name:
                continue
            actions.append(("merge_into_canonical", s, canonical_name, dest_path))

    # Singletons with leading zeros should be renamed to canonical if free
    for lst in groups.values():
        if len(lst) != 1:
            continue
        s = lst[0]
        if s.name.startswith("0") and s.name != "0":
            cname = canonical_id(s.name)
            cpath = root / cname
            if not cpath.exists():
                actions.append(("rename_to_canonical", s, cname, cpath))
            else:
                # merge into existing canonical
                actions.append(("merge_into_canonical", s, cname, cpath))

    if not actions:
        print("[ok] nothing to do")
        return 0

    # Print plan (unique actions)
    print("\n=== Plan ===")
    for action, src, dest_name, dest_path in actions:
        print(
            f"{action:20} {src.name:>4} -> {dest_name:>4} | "
            f"src(suf={src.has_suffix},pre={src.has_prefix},files={src.file_count},bytes={src.total_bytes},newest={src.newest_mtime_iso()})"
        )

    if not args.apply:
        print("\n[dry-run] Run with --apply to execute")
        return 0

    print("\n=== Apply ===")
    ensure_dir(backup_root)

    # Execute actions; keep a set to avoid repeating work on a folder after rename
    processed: set[str] = set()

    for action, src, dest_name, dest_path in actions:
        if src.path.name in processed:
            continue

        # If src path no longer exists (e.g., renamed earlier), skip
        if not src.path.exists():
            processed.add(src.path.name)
            continue

        if action == "rename_to_canonical":
            if dest_path.exists():
                # Unexpected (race), fall back to merge
                print(f"[warn] dest exists, merging instead: {src.path} -> {dest_path}")
                ensure_dir(dest_path)
                rc = run_robocopy_missing_only(src.path, dest_path)
                if rc >= 8:
                    print(f"[error] robocopy failed rc={rc} for {src.path} -> {dest_path}")
                    return 3
                backup_path = backup_root / src.path.name
                if backup_path.exists():
                    backup_path = backup_root / f"{src.path.name}_{int(datetime.now().timestamp())}"
                shutil.move(str(src.path), str(backup_path))
                processed.add(src.path.name)
                continue

            print(f"[rename] {src.path.name} -> {dest_name}")
            src.path.rename(dest_path)
            processed.add(src.path.name)
            continue

        if action == "merge_into_canonical":
            ensure_dir(dest_path)
            print(f"[merge] {src.path.name} -> {dest_name} (missing-only)")
            rc = run_robocopy_missing_only(src.path, dest_path)
            if rc >= 8:
                print(f"[error] robocopy failed rc={rc} for {src.path} -> {dest_path}")
                return 3
            backup_path = backup_root / src.path.name
            if backup_path.exists():
                backup_path = backup_root / f"{src.path.name}_{int(datetime.now().timestamp())}"
            shutil.move(str(src.path), str(backup_path))
            processed.add(src.path.name)
            continue

        print(f"[warn] unknown action: {action}")

    print(f"\n[ok] done. zero-prefixed folders moved to: {backup_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
