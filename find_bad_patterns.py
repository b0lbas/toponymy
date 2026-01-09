import json
from pathlib import Path

p = json.load(open('web/public/data/124/patterns.json'))

BLACKLIST = [
    'road', 'mountain', 'creek', 'island', 'islands', 'lake', 'river', 
    'colony', 'falls', 'beach', 'bay', 'harbour', 'harbor', 'inlet', 
    'point', 'ridge', 'valley', 'brook', 'stream', 'fork', 'forks',
    'hill', 'hills', 'park', 'ranch', 'station', 'junction', 'crossing', 
    'portage', 'narrows', 'pond', 'cove', 'corner', 'corners', 'landing',
    'settlement', 'reserve', 'rapids'
]

bad = [x for x in p['patterns'] if any(w in x['pattern'] for w in BLACKLIST)]
good = [x for x in p['patterns'] if not any(w in x['pattern'] for w in BLACKLIST)]

print(f"Found {len(bad)} bad patterns out of {len(p['patterns'])} total")
print(f"Will keep {len(good)} good patterns\n")

print("First 50 bad patterns:")
for x in bad[:50]:
    print(f"{x['pattern']:25s} {x['places']:5d} places")

print("\n" + "="*60)
print(f"\nTotal bad: {len(bad)}, Total good: {len(good)}")
