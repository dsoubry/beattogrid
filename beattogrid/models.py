from dataclasses import dataclass
from typing import List, Optional

@dataclass
class BeatAnalysis:
    sample_rate: int
    beats: List[float]           # seconden
    downbeats: Optional[List[float]]
    bpm_estimate: float

@dataclass
class GridSettings:
    target_bpm: float
    strength: float              # 0.0–1.0
    anchor_downbeat: int = 0     # index van maat 1

@dataclass
class WarpResult:
    audio: list                  # numpy array
    sample_rate: int
    bpm: float
