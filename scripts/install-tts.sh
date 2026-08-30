#!/usr/bin/env bash
# Install and start the Kokoro TTS runtime used to generate narrations.
#
# Kokoro TTS is a separate project: https://github.com/geekychris/kokoro_runtime
# It's a small Rust server that runs a local ONNX build of the Kokoro-82M speech
# model, exposing an HTTP + MCP API on 127.0.0.1:8770. Everything is offline
# after the one-time model download (~340 MB).
#
# Two modes:
#
#   Default   — runs the upstream one-line installer, which clones into
#               ~/.kokoro/src, downloads the model, builds kokoro-server,
#               starts it on 127.0.0.1:8770, and (optionally) registers the
#               Claude Code MCP server + `speak-content` skill.
#
#   --sibling — clones (or `git pull`s) the repo into ../kokoro_runtime
#               relative to this project so both live side-by-side. Useful
#               if you want to hack on Kokoro locally.
#
# Environment knobs (forwarded to the upstream installer):
#   KOKORO_AUTO_INSTALL=1   — allow it to `brew`/`apt` install missing prereqs
#                             (rust toolchain, espeak-ng, jq)
#   KOKORO_START=0          — build only, don't start the server
#   KOKORO_SKILL=0          — skip installing the Claude Code skill
#   KOKORO_MCP_REGISTER=0   — skip `claude mcp add` for the kokoro tool
#
# Usage:
#   ./scripts/install-tts.sh                        # default install
#   KOKORO_AUTO_INSTALL=1 ./scripts/install-tts.sh  # let it apt/brew missing deps
#   ./scripts/install-tts.sh --sibling              # clone next to model_viewer

set -euo pipefail

REPO_URL="https://github.com/geekychris/kokoro_runtime.git"
INSTALLER_URL="https://raw.githubusercontent.com/geekychris/kokoro_runtime/main/scripts/install.sh"

SIBLING=0
for arg in "$@"; do
  case "$arg" in
    --sibling)  SIBLING=1 ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Try:  $0 --help" >&2
      exit 2
      ;;
  esac
done

# Make sure we can talk to git
if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required." >&2
  exit 1
fi

if [ "$SIBLING" -eq 1 ]; then
  PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  SIBLING_DIR="$(cd "$PROJECT_DIR/.." && pwd)/kokoro_runtime"
  if [ -d "$SIBLING_DIR/.git" ]; then
    echo "Updating existing sibling checkout at $SIBLING_DIR"
    git -C "$SIBLING_DIR" pull --ff-only
  else
    echo "Cloning $REPO_URL into $SIBLING_DIR ..."
    git clone "$REPO_URL" "$SIBLING_DIR"
  fi
  echo "Running its install.sh in place ..."
  KOKORO_SRC="$SIBLING_DIR" \
    KOKORO_AUTO_INSTALL="${KOKORO_AUTO_INSTALL:-0}" \
    KOKORO_START="${KOKORO_START:-1}" \
    KOKORO_SKILL="${KOKORO_SKILL:-1}" \
    KOKORO_MCP_REGISTER="${KOKORO_MCP_REGISTER:-1}" \
    bash "$SIBLING_DIR/scripts/install.sh"
else
  echo "Running upstream Kokoro installer (clones to ~/.kokoro/src by default) ..."
  curl -fsSL "$INSTALLER_URL" | \
    KOKORO_AUTO_INSTALL="${KOKORO_AUTO_INSTALL:-0}" \
    KOKORO_START="${KOKORO_START:-1}" \
    KOKORO_SKILL="${KOKORO_SKILL:-1}" \
    KOKORO_MCP_REGISTER="${KOKORO_MCP_REGISTER:-1}" \
    bash
fi

echo
if curl -sf --max-time 2 http://127.0.0.1:8770/health >/dev/null 2>&1; then
  echo "✓ kokoro-server is running at http://127.0.0.1:8770/"
  echo "  Next: ./scripts/regen-narration.sh   # rebuild the demo narrations"
else
  echo "kokoro-server is not reachable yet."
  echo "If the installer built but didn't start it, try starting it manually — see"
  echo "  https://github.com/geekychris/kokoro_runtime#manual-quick-start"
fi
