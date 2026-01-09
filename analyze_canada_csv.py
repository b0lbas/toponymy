import pandas as pd

# Blacklist of words that indicate non-city places
BLACKLIST = [
    'road', 'mountain', 'creek', 'island', 'islands', 'lake', 'river', 
    'colony', 'falls', 'beach', 'bay', 'harbour', 'harbor', 'inlet', 
    'point', 'ridge', 'valley', 'brook', 'stream', 'fork', 'forks',
    'hill', 'hills', 'park', 'ranch', 'station', 'junction', 'crossing', 
    'portage', 'narrows', 'pond', 'cove', 'corner', 'corners', 'landing',
    'settlement', 'reserve', 'rapids', 'bridge', 'branch'
]

df = pd.read_csv('data-pipeline/intermediate/124_canada_places.csv')

print(f"Original places: {len(df):,}")

# Find places with blacklisted words in their normalized names
bad_mask = df['name_norm'].str.contains('|'.join(BLACKLIST), case=False, regex=True, na=False)
bad_places = df[bad_mask]
good_places = df[~bad_mask]

print(f"Places with bad words: {len(bad_places):,}")
print(f"Good places remaining: {len(good_places):,}")

print("\nTop 30 places to be removed:")
for idx, row in bad_places.head(30).iterrows():
    print(f"  {row['name']:40s} -> {row['name_norm']:40s}")

print(f"\nTotal to remove: {len(bad_places):,}")
print(f"Will keep: {len(good_places):,}")
