import json
import os
from pathlib import Path

# Blacklist of non-city suffixes
BLACKLIST = [
    'road', 'mountain', 'creek', 'island', 'islands', 'lake', 'river', 
    'colony', 'falls', 'beach', 'bay', 'harbour', 'harbor', 'inlet', 
    'point', 'ridge', 'valley', 'brook', 'stream', 'fork', 'forks',
    'hill', 'hills', 'park', 'ranch', 'station', 'junction', 'crossing', 
    'portage', 'narrows', 'pond', 'cove', 'corner', 'corners', 'landing',
    'settlement', 'reserve', 'rapids', 'bridge', 'branch'
]

def clean_country_data(country_id: str, base_paths: list):
    """Remove unwanted patterns from country export directories."""
    
    for base in base_paths:
        patterns_file = Path(base) / country_id / "patterns.json"
        
        if not patterns_file.exists():
            print(f"[skip] {patterns_file} does not exist")
            continue
            
        print(f"\n[processing] {patterns_file}")
        
        # Load patterns
        with open(patterns_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        original_count = len(data['patterns'])
        
        # Filter out bad patterns
        bad_patterns = []
        good_patterns = []
        
        for p in data['patterns']:
            pattern = p['pattern']
            if any(w in pattern for w in BLACKLIST):
                bad_patterns.append(p)
            else:
                good_patterns.append(p)
        
        print(f"  Original: {original_count} patterns")
        print(f"  Bad: {len(bad_patterns)} patterns")
        print(f"  Good: {len(good_patterns)} patterns")
        
        # Delete bad pattern files
        data_dir = Path(base) / country_id
        deleted_count = 0
        
        for p in bad_patterns:
            file_path = data_dir / p['file']
            if file_path.exists():
                file_path.unlink()
                deleted_count += 1
                print(f"  [deleted] {p['file']}")
        
        print(f"  Deleted {deleted_count} .json.gz files")
        
        # Update patterns.json with only good patterns
        data['patterns'] = good_patterns
        
        with open(patterns_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"  [updated] patterns.json with {len(good_patterns)} clean patterns")

if __name__ == "__main__":
    # Clean both export and web public directories
    clean_country_data("124", [
        "data-pipeline/export/web/public/data",
        "web/public/data"
    ])
    
    print("\n" + "="*60)
    print("✓ Cleanup complete!")
