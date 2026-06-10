#!/usr/bin/env python3
"""
Generate games.json from local games/ and thumbnails/ folders.
Run this script from the folder that contains both subfolders.
Handles spaces in filenames: URLs use %20, titles keep spaces.
"""

import os
import json
import glob
from pathlib import Path

# ----------------------------------------------------------------------
# CONFIGURATION - adjust if your repository structure differs
# ----------------------------------------------------------------------
BASE_RAW_URL = "https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/"
GAMES_DIR = "games"
THUMBNAILS_DIR = "thumbnails"
OUTPUT_FILE = "games.json"

# Supported image extensions (in order of preference if multiple matches)
IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]

# ----------------------------------------------------------------------
def find_thumbnail(basename, thumbnails_path):
    """Find a thumbnail file with the given basename and any supported extension."""
    for ext in IMAGE_EXTENSIONS:
        candidate = thumbnails_path / f"{basename}{ext}"
        if candidate.is_file():
            return candidate.name  # return filename with extension
    return None

def url_encode_filename(filename):
    """Replace spaces with %20 in filenames for GitHub raw URLs."""
    return filename.replace(" ", "%20")

def main():
    # Get current working directory (where script is run)
    cwd = Path.cwd()
    games_path = cwd / GAMES_DIR
    thumbs_path = cwd / THUMBNAILS_DIR

    # Validate folders exist
    if not games_path.is_dir():
        print(f"Error: '{GAMES_DIR}' folder not found in {cwd}")
        return
    if not thumbs_path.is_dir():
        print(f"Error: '{THUMBNAILS_DIR}' folder not found in {cwd}")
        return

    # Find all .html files in games folder
    html_files = list(games_path.glob("*.html"))
    if not html_files:
        print("No .html files found in games folder.")
        return

    games_list = []
    missing_thumbnails = []

    for html_path in html_files:
        # Get base name (e.g., "10 Minutes Till Dawn" from "10 Minutes Till Dawn.html")
        basename = html_path.stem  # This keeps spaces as-is
        
        # URL encode the filename for GitHub raw URL
        encoded_html_name = url_encode_filename(html_path.name)
        game_url = f"{BASE_RAW_URL}{GAMES_DIR}/{encoded_html_name}"

        # Find matching thumbnail
        thumb_file = find_thumbnail(basename, thumbs_path)
        if thumb_file is None:
            missing_thumbnails.append(basename)
            continue

        encoded_thumb_name = url_encode_filename(thumb_file)
        image_url = f"{BASE_RAW_URL}{THUMBNAILS_DIR}/{encoded_thumb_name}"

        games_list.append({
            "title": basename,  # Keep original spaces in the title
            "url": game_url,
            "image": image_url
        })

    # Write output JSON
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(games_list, f, indent=2, ensure_ascii=False)

    print(f"Generated {OUTPUT_FILE} with {len(games_list)} games.")
    if missing_thumbnails:
        print(f"Warning: No thumbnail found for: {', '.join(missing_thumbnails)}")

if __name__ == "__main__":
    main()