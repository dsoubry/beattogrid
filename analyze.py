import librosa
import numpy as np
from .models import BeatAnalysis

def analyze_audio(path: str) -> BeatAnalysis:
    y, sr = librosa.load(path, sr=None, mono=True)

    tempo, beat_frames = librosa.beat.beat_track(
        y=y,
        sr=sr,
        units="frames"
    )

    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    # Downbeats later verfijnen (bv. madmom), nu placeholder
    downbeats = None

    return BeatAnalysis(
        sample_rate=sr,
        beats=beat_times.tolist(),
        downbeats=downbeats,
        bpm_estimate=float(tempo)
    )
