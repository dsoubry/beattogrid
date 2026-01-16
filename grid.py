import numpy as np
from .models import BeatAnalysis, GridSettings

def build_corrected_grid(
    analysis: BeatAnalysis,
    settings: GridSettings
):
    beats = np.array(analysis.beats)

    seconds_per_beat = 60.0 / settings.target_bpm
    anchor = beats[settings.anchor_downbeat]

    ideal_grid = anchor + np.arange(len(beats)) * seconds_per_beat

    # strength blending (DJ-feel behouden!)
    corrected = beats + settings.strength * (ideal_grid - beats)

    return corrected.tolist()
