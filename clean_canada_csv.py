import pandas as pd
import shutil
from pathlib import Path

# Blacklist of words that indicate non-city places
BLACKLIST = [
    'road', 'mountain', 'creek', 'island', 'islands', 'lake', 'river', 
    'colony', 'falls', 'beach', 'bay', 'harbour', 'harbor', 'inlet', 
    'point', 'ridge', 'valley', 'brook', 'stream', 'fork', 'forks',
    'hill', 'hills', 'park', 'ranch', 'station', 'junction', 'crossing', 
    'portage', 'narrows', 'pond', 'cove', 'corner', 'corners', 'landing',
    'settlement', 'reserve', 'rapids', 'bridge', 'branch'
]

csv_path = Path('data-pipeline/intermediate/124_canada_places.csv')
backup_path = Path('data-pipeline/intermediate/124_canada_places.csv.backup')

# Backup original
print(f"Creating backup: {backup_path}")
shutil.copy2(csv_path, backup_path)

# Read CSV
df = pd.read_csv(csv_path)
print(f"Original places: {len(df):,}")

# Filter out places with blacklisted words
bad_mask = df['name_norm'].str.contains('|'.join(BLACKLIST), case=False, regex=True, na=False)
good_places = df[~bad_mask]

print(f"Places removed: {len(df) - len(good_places):,}")
print(f"Places kept: {len(good_places):,}")

# Save cleaned CSV
good_places.to_csv(csv_path, index=False)
print(f"\n✓ Saved cleaned CSV to {csv_path}")
print(f"✓ Original backed up to {backup_path}")
