import soundfile as sf

def export_wav(path, audio, sr):
    sf.write(
        path,
        audio,
        sr,
        subtype="PCM_16"
    )
