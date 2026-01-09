import pandas as pd

df = pd.read_csv('data-pipeline/intermediate/124_canada_places.csv')

print("Checking remaining suspicious patterns:\n")

suspicious_suffixes = {
    '-ad': 'ad',
    '-land': 'land', 
    '-ook': 'ook',
    '-ver': 'ver',
    '-let': 'let',
    '-our': 'our',
    '-dge': 'dge'
}

for pattern, suffix in suspicious_suffixes.items():
    print(f"\n{pattern} ({suffix}):")
    matches = df[df['name_norm'].str.endswith(suffix, na=False)]
    print(f"  Total: {len(matches)} places")
    print(f"  Examples:")
    for idx, row in matches.head(10).iterrows():
        print(f"    {row['name']:30s} -> {row['name_norm']}")
