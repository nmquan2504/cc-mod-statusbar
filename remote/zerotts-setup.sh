#!/bin/sh
# ZeroTTS for the phone's Vietnamese voice: a Python of its own (3.12, which onnxruntime ships for)
# and the model in a plain folder (onnxruntime refuses the Hugging Face cache's links), under
# ~/.cache/cc-mod-statusbar/zerotts. `ready` there says it is done. Run by /zerotts-install.
set -eu
TTS_HOME="${QSB_TTS_HOME:-$HOME/.cache/cc-mod-statusbar/zerotts}"
mkdir -p "$TTS_HOME"
cd "$TTS_HOME"
rm -f ready failed
trap 'touch failed' EXIT
echo "Installing ZeroTTS in $TTS_HOME"
if command -v uv >/dev/null 2>&1; then
  uv venv -q --allow-existing --python 3.12 .venv
  uv pip install -q --python .venv/bin/python 'zerotts==0.1.5'
else
  PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
  [ -n "$PY" ] || { echo "Needs uv, or Python 3.10 to 3.12 (brew install uv)"; exit 1; }
  "$PY" -m venv .venv
  .venv/bin/pip install -q 'zerotts==0.1.5'
fi
echo "Downloading the model (about 900 MB)"
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('zeroweight-ai/ZeroTTS', local_dir='model')"
trap - EXIT
touch ready
echo "ZeroTTS is ready"
