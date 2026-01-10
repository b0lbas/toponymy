"""
Clean place names in all existing CSV files:
- Remove parentheses, brackets, quotes and their contents
- Remove all digits
- Remove special characters, keeping only letters (any alphabet), spaces, hyphens, apostrophes
- Normalize whitespace
"""
import re
import pathlib
import pandas as pd
from tqdm import tqdm

ROOT = pathlib.Path(__file__).resolve().parents[1]
INTERMEDIATE = ROOT / "intermediate"

def clean_name(name: str) -> str:
    """Clean place name from special characters, keeping only letters, spaces, hyphens, apostrophes"""
    if not name or not isinstance(name, str):
        return ""
    
    # Remove content in parentheses and brackets
    s = re.sub(r"\([^\)]*\)", " ", name)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"\{[^\}]*\}", " ", s)
    
    # Remove quotes
    s = re.sub(r'[""]', " ", s)
    s = re.sub(r'[«»„"❝❞]', " ", s)
    
    # Remove all digits
    s = re.sub(r"\d+", " ", s)
    
    # Normalize quotes and dashes to standard versions
    s = re.sub(r"[''`´]", "'", s)
    s = re.sub(r"[-–—]+", "-", s)
    
    # Remove all special characters except letters (any alphabet), spaces, hyphens, apostrophes
    # \p{L} would work with regex module, but using standard re we keep everything that's not explicitly removed
    # Keep: letters (any unicode), spaces, hyphens, apostrophes
    s = re.sub(r"[^\w\s\-']", " ", s, flags=re.UNICODE)
    
    # Normalize whitespace
    s = re.sub(r"\s+", " ", s).strip()
    
    return s

def main():
    csv_files = sorted(INTERMEDIATE.glob("*_places.csv"))
    
    if not csv_files:
        print("[info] No CSV files found in intermediate/")
        return
    
    print(f"[info] Found {len(csv_files)} CSV files to clean")
    
    for csv_path in tqdm(csv_files, desc="Cleaning CSV files"):
        try:
            df = pd.read_csv(csv_path)
            
            if 'name' not in df.columns:
                print(f"[skip] {csv_path.name} - no 'name' column")
                continue
            
            # Store original for comparison
            original_count = len(df)
            original_names = df['name'].tolist()
            
            # Clean names
            df['name'] = df['name'].apply(clean_name)
            
            # Remove empty names
            df = df[df['name'].str.len() > 0].reset_index(drop=True)
            
            # Count changes
            cleaned_names = df['name'].tolist()
            changes = sum(1 for i, name in enumerate(cleaned_names) if i < len(original_names) and name != original_names[i])
            removed = original_count - len(df)
            
            if changes > 0 or removed > 0:
                # Save back
                df.to_csv(csv_path, index=False)
                print(f"[clean] {csv_path.name}: {changes} names cleaned, {removed} empty removed")
            else:
                print(f"[ok] {csv_path.name}: no changes needed")
                
        except Exception as e:
            print(f"[error] {csv_path.name}: {e}")
    
    print("[done] All CSV files cleaned")

if __name__ == "__main__":
    main()
