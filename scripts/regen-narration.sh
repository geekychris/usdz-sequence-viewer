#!/usr/bin/env bash
# Regenerate the 10 showcase-scene narrations via a running kokoro-server.
#
# Prereqs:
#   - kokoro-server running on http://127.0.0.1:8770 (see ./install-tts.sh)
#   - jq on PATH (`brew install jq`)
#
# Environment:
#   KOKORO_URL — override the server URL (default http://127.0.0.1:8770)
#   VOICE      — Kokoro voice name (default af_bella; run `curl $KOKORO_URL/voices`)
#
# Writes 10 mp3s into ./audio/.

set -euo pipefail
cd "$(dirname "$0")/.."

KOKORO_URL="${KOKORO_URL:-http://127.0.0.1:8770}"
VOICE="${VOICE:-af_bella}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required. Install with 'brew install jq' or 'apt install jq'." >&2
  exit 1
fi

if ! curl -sf --max-time 2 "$KOKORO_URL/health" >/dev/null; then
  echo "ERROR: kokoro-server not reachable at $KOKORO_URL" >&2
  echo "Start it first:  ./scripts/install-tts.sh" >&2
  exit 1
fi

mkdir -p audio

speak() {
  local out="$1"; local text="$2"
  local path="$(pwd)/audio/${out}"
  local body
  body=$(jq -nc --arg t "$text" --arg p "$path" --arg v "$VOICE" \
    '{jsonrpc:"2.0", method:"tools/call", id:1,
      params:{name:"speak", arguments:{text:$t, voice:$v, format:"mp3", output_path:$p}}}')
  local resp
  resp=$(curl -sf -X POST "$KOKORO_URL/mcp" -H "Content-Type: application/json" -d "$body")
  local msg
  msg=$(printf '%s' "$resp" | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['content'][0]['text'])" 2>/dev/null || echo "$resp")
  printf '  %-20s  %s\n' "$out" "$msg"
}

echo "Regenerating narrations (voice=$VOICE) ..."
speak intro.mp3       "Meet the Lemmings, a small cast of characters."
speak superhero.mp3   "The Superhero!"
speak wizard.mp3      "The Wizard. Knows a thing or two."
speak rockstar.mp3    "Rock on! The Rock Star!"
speak chef.mp3        "The Chef!"
speak professor.mp3   "The Professor. A lemming a day keeps the doctor away."
speak programmer.mp3  "The Programmer. To-do: sleep."
speak builder.mp3     "The Builder. Can we fix it? Yes we can!"
speak mistress.mp3    "The Mistress."
speak outro.mp3       "And one to rule them all. Fin."

echo
echo "Done — see audio/*.mp3. Referenced from showcase.json under scene.audio.src."
