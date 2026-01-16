import numpy as np
from dataclasses import dataclass
from .analyze import BeatAnalysis

@dataclass
class GridSettings:
    target_bpm: float
    strength: float
    anchor_beat_index: int = 0  # later: downbeat anchor

def build_corrected_grid(analysis: BeatAnalysis, settings: GridSettings):
    beats = np.array(analysis.beats, dtype=np.float64)

    seconds_per_beat = 60.0 / float(settings.target_bpm)
    idx = int(np.clip(settings.anchor_beat_index, 0, len(beats) - 1))
    anchor = beats[idx]

    ideal = anchor + np.arange(len(beats)) * seconds_per_beat
    corrected = beats + float(settings.strength) * (ideal - beats)
    return corrected.tolist()
