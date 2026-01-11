from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from pathlib import Path


PLACES_RE = re.compile(r"^(\d+)_.*_places\.csv$")


@dataclass(frozen=True)
class CsvRoot:
    path: Path
    files: int
    ids: set[int]


def scan_csv_root(root: Path) -> CsvRoot | None:
    if not root.is_dir():
        return None

    ids: set[int] = set()
    files = 0
    for entry in root.iterdir():
        if not entry.is_file():
            continue
        m = PLACES_RE.match(entry.name)
        if not m:
            continue
        files += 1
        try:
            ids.add(int(m.group(1)))
        except ValueError:
            continue

    return CsvRoot(path=root, files=files, ids=ids)


def scan_web_data_ids(web_data: Path) -> set[int]:
    ids: set[int] = set()
    if not web_data.is_dir():
        return ids

    for entry in web_data.iterdir():
        if not entry.is_dir():
            continue
        name = entry.name
        if not name.isdigit():
            continue
        try:
            ids.add(int(name))
        except ValueError:
            continue
    return ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root (default: parent of scripts/)",
    )
    parser.add_argument(
        "--web-data",
        type=Path,
        default=Path("web/public/data"),
        help="Web data directory with numeric id folders",
    )
    parser.add_argument(
        "--csv-root",
        type=Path,
        default=None,
        help="Override places.csv root; otherwise picks the largest among known candidates",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max ids to print per list",
    )

    args = parser.parse_args()
    repo = args.repo.resolve()
    web_data = (repo / args.web_data).resolve() if not args.web_data.is_absolute() else args.web_data.resolve()

    candidates = [
        repo / "intermediate",
        repo / "data-pipeline" / "intermediate",
        repo / "data-pipeline" / "data-pipeline" / "intermediate",
    ]

    if args.csv_root is not None:
        chosen = scan_csv_root(args.csv_root.resolve())
        if chosen is None:
            print(f"[error] csv-root not found: {args.csv_root}")
            return 2
        csv_roots = [chosen]
    else:
        csv_roots = [r for r in (scan_csv_root(c) for c in candidates) if r is not None]
        if not csv_roots:
            print("[error] no csv roots found")
            return 2
        chosen = max(csv_roots, key=lambda r: (r.files, len(r.ids)))

    web_ids = scan_web_data_ids(web_data)
    csv_ids = chosen.ids

    in_web_not_in_csv = sorted(web_ids - csv_ids)
    in_csv_not_in_web = sorted(csv_ids - web_ids)
    in_both = sorted(web_ids & csv_ids)

    print("[info] repo:", repo)
    print("[info] web-data:", web_data)
    if args.csv_root is None:
        for r in sorted(csv_roots, key=lambda x: str(x.path)):
            print(f"[info] candidate csv-root: {r.path} files={r.files} unique_ids={len(r.ids)}")
    print(f"[info] chosen csv-root: {chosen.path} files={chosen.files} unique_ids={len(chosen.ids)}")

    print("\n=== Summary ===")
    print("web ids:", len(web_ids))
    print("csv ids:", len(csv_ids))
    print("both:", len(in_both))
    print("in web but no csv:", len(in_web_not_in_csv))
    print("in csv but no web:", len(in_csv_not_in_web))

    def show(title: str, items: list[int]) -> None:
        print(f"\n=== {title} (first {min(len(items), args.limit)} of {len(items)}) ===")
        for x in items[: args.limit]:
            print(x)

    show("IDs in web/public/data but missing *_places.csv", in_web_not_in_csv)
    show("IDs in *_places.csv but missing from web/public/data", in_csv_not_in_web)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
