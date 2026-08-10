#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# refresh the directly imported icon subset
cd "$repo_root"
yarn camera:icons
cd "$script_dir"
python3 annotator-server.py
