import json

p = json.load(open('web/public/data/124/patterns.json'))
print(f'Canada now has {len(p["patterns"])} patterns')

top10 = [x['pattern'] for x in p['patterns'][:10]]
print(f'Top 10: {", ".join(top10)}')

bad_check = [x for x in p['patterns'] if any(w in x['pattern'] for w in ['road','mountain','colony','creek','island','lake','river','bay','harbour','station'])]
print(f'Remaining bad patterns: {len(bad_check)}')

if bad_check:
    print("WARNING: Still have bad patterns:")
    for x in bad_check[:10]:
        print(f"  {x['pattern']}")
else:
    print("✓ All non-city patterns successfully removed!")
