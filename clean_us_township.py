import pandas as pd
import re
from pathlib import Path

CSV = Path('data-pipeline/intermediate/840_us_places.csv')
BACKUP = CSV.with_suffix('.csv.backup')

TOWNSHIP_RE = re.compile(r"\btownship\b", re.IGNORECASE)
CHARTER_RE = re.compile(r"\bcharter\b", re.IGNORECASE)

def strip_noise(s: str) -> str:
    s2 = TOWNSHIP_RE.sub(' ', s)
    s2 = CHARTER_RE.sub(' ', s2)
    s2 = re.sub(r"\s+", " ", s2).strip()
    return s2

def main():
    if not CSV.exists():
        print(f"[missing] {CSV}")
        return
    if not BACKUP.exists():
        BACKUP.write_bytes(CSV.read_bytes())
        print(f"[backup] {BACKUP}")

    df = pd.read_csv(CSV)
    before = len(df)
    df['name'] = df['name'].astype(str).apply(strip_noise)
    df['name_norm'] = df['name_norm'].astype(str).apply(strip_noise)

    # drop rows where name became empty
    df = df[df['name'].str.strip() != ""]
    after = len(df)

    df.to_csv(CSV, index=False)
    print(f"[ok] cleaned {before} -> {after} rows; township/charter removed from names")

if __name__ == '__main__':
    main()
