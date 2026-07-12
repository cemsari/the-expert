#!/bin/bash
# THE EXPERT — one-click installer. Double-click me.
cd "$(dirname "$0")"
echo "🦥 Installing The Expert…"
python3 -m pip install --break-system-packages --quiet claude-agent-sdk 2>/dev/null
echo "✅ Dependencies ready."
echo "Launching…"
exec python3 expert.py
