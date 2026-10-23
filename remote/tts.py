# ZeroTTS, the phone's Vietnamese voice made on the Mac: the hub starts this beside it the first time
# the phone asks for speech, and talks to it a JSON line at a time on stdin and stdout. The first
# line out says it is ready and names its voices; each request after carries an id, and its answer
# the same id with a WAV (24 kHz, 16-bit, mono) in base64, or an error. A piece in English (lang en)
# skips the Vietnamese text normalizer, which would read its numbers in Vietnamese. Run by the Python that
# zerotts-setup.sh made: python tts.py <model folder>.
import base64
import io
import json
import sys


def say(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def main(model_dir):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    from zerotts import ZeroTTS, normalize_vi_text

    tts = ZeroTTS.from_pretrained(model_dir)
    voices = list(tts.list_voices())
    say({'ready': True, 'voices': voices})
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = req.get('id')
        try:
            text = str(req.get('text', ''))[:2000]
            text = (text if req.get('lang') == 'en' else normalize_vi_text(text)).strip()
            if not text:
                raise ValueError('no text')
            voice = req.get('voice') if req.get('voice') in voices else ('maichi' if 'maichi' in voices else voices[0])
            audio = np.asarray(tts.synthesize(text, voice=voice), dtype=np.float32).reshape(-1)
            # 48 kHz from the model, halved: speech loses nothing a phone speaker plays, the file half
            audio = resample_poly(audio, 1, 2) if tts.sample_rate == 48000 else audio
            rate = 24000 if tts.sample_rate == 48000 else tts.sample_rate
            buf = io.BytesIO()
            sf.write(buf, audio, rate, format='WAV', subtype='PCM_16')
            say({'id': rid, 'b64': base64.b64encode(buf.getvalue()).decode('ascii')})
        except Exception as e:  # one sentence that fails is that sentence's error, not the end
            say({'id': rid, 'error': str(e)[:200]})


if __name__ == '__main__':
    main(sys.argv[1])
