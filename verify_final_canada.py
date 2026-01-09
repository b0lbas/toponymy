import json

p = json.load(open('web/public/data/124/patterns.json'))

print(f"Canada now has {len(p['patterns'])} patterns (was 629 after first cleanup)")
print()

# Check for problematic patterns
bad_suffixes = ['oad', 'ad', 'olony', 'lony', 'ony', 'untain', 'tain', 'eek', 'ek', 
                'land', 'ake', 'ver', 'alls', 'each', 'arbour', 'our', 'let', 
                'oint', 'int', 'idge', 'dge', 'alley', 'lley', 'rook', 'ook']

# Find patterns that are just suffixes of blacklisted words
suspicious = []
for pattern in p['patterns']:
    pat = pattern['pattern'].lstrip('-')
    for bad in bad_suffixes:
        if pat == bad:
            suspicious.append(pattern)
            break

if suspicious:
    print(f"Found {len(suspicious)} suspicious patterns that are suffixes of bad words:")
    for x in suspicious[:20]:
        print(f"  {x['pattern']:20s} {x['places']:5d} places")
else:
    print("✓ No suspicious suffix-only patterns found!")

print()

# Show top 15 patterns
print("Top 15 patterns:")
for x in p['patterns'][:15]:
    print(f"  {x['pattern']:20s} {x['places']:5d} places  score={x['score']:.3f}")
