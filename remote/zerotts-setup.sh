#!/bin/sh
# ZeroTTS for the phone's Vietnamese voice: a Python of its own (3.12, which onnxruntime ships for)
# and the model in a plain folder (onnxruntime refuses the Hugging Face cache's links), under
# ~/.cache/cc-mod-statusbar/zerotts. `ready` there says it is done. Run by /zerotts-install.
# Every package comes at the version and hash zerotts-requirements.txt names, and the model at one
# commit, so an upstream release does not reach this Mac unasked.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REQS="$HERE/zerotts-requirements.txt"
MODEL_REVISION=c2bfbd67dc648cac455077333f7cf5c18a2e3bb4
TTS_HOME="${QSB_TTS_HOME:-$HOME/.cache/cc-mod-statusbar/zerotts}"
mkdir -p "$TTS_HOME"
cd "$TTS_HOME"
rm -f ready failed
trap 'touch failed' EXIT
echo "Installing ZeroTTS in $TTS_HOME"
if command -v uv >/dev/null 2>&1; then
  uv venv -q --allow-existing --python 3.12 .venv
  uv pip install -q --python .venv/bin/python --require-hashes -r "$REQS"
else
  # the pinned packages are for 3.12, the Python they were resolved for
  PY=$(command -v python3.12 || true)
  [ -n "$PY" ] || { echo "Needs uv, or Python 3.12 (brew install uv)"; exit 1; }
  "$PY" -m venv .venv
  .venv/bin/pip install -q --require-hashes -r "$REQS"
fi
echo "Downloading the model (about 900 MB)"
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('zeroweight-ai/ZeroTTS', revision='$MODEL_REVISION', local_dir='model')"
trap - EXIT
touch ready
echo "ZeroTTS is ready"
