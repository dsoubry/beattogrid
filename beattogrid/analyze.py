import librosa
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class BeatAnalysis:
    sample_rate: int
    beats: List[float]
    downbeats: Optional[List[float]]
    bpm_estimate: float


def analyze_audio(path: str) -> BeatAnalysis:
    # Load mono for analysis (audio warping gebeurt later stereo-safe)
    y, sr = librosa.load(path, sr=None, mono=True)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    if len(beat_times) < 8:
        raise RuntimeError("Te weinig beats gevonden. Probeer een ander fragment of een andere track.")

    return BeatAnalysis(
        sample_rate=sr,
        beats=beat_times.tolist(),
        downbeats=None,  # later uitbreidbaar
        bpm_estimate=float(tempo),
    )
