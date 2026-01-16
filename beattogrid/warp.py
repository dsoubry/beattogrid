from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
import librosa

try:
    import pyrubberband as pyrb
    HAS_RUBBERBAND = True
except Exception:
    HAS_RUBBERBAND = False


@dataclass
class WarpOptions:
    """
    Options for warping audio to a corrected beat grid.
    """
    engine: str = "auto"            # "auto" | "rubberband" | "librosa"
    crossfade_ms: int = 10          # 0..20 typical
    min_seg_ms: int = 40            # very short segments won't be stretched (avoid artifacts)
    headroom_db: float = 1.0        # normalize to -headroom dBFS peak (simple safety)


def _to_2d(y: np.ndarray) -> np.ndarray:
    """
    Ensure audio is shape (n_samples, n_channels).
    Accepts mono (n,) or (n, ch).
    """
    if y.ndim == 1:
        return y[:, None]
    if y.ndim == 2:
        return y
    raise ValueError("Audio array must be 1D (mono) or 2D (stereo/multichannel).")


def _choose_engine(engine: str) -> str:
    engine = (engine or "auto").lower()
    if engine == "auto":
        return "rubberband" if HAS_RUBBERBAND else "librosa"
    if engine == "rubberband":
        if not HAS_RUBBERBAND:
            raise RuntimeError("Engine 'rubberband' requested but pyrubberband/rubberband not available.")
        return "rubberband"
    if engine == "librosa":
        return "librosa"
    raise ValueError("engine must be one of: auto, rubberband, librosa")


def _time_stretch_1ch(seg: np.ndarray, sr: int, rate: float, engine: str) -> np.ndarray:
    """
    Stretch a mono segment to new duration by specifying rate = in_len / out_len
    - rate > 1.0 => speed up (shorter)
    - rate < 1.0 => slow down (longer)
    """
    # Avoid pathological rates
    rate = float(np.clip(rate, 0.25, 4.0))

    if engine == "rubberband":
        # pyrubberband prefers float64
        out = pyrb.time_stretch(seg.astype(np.float64), sr, rate)
        return out.astype(np.float32)

    # librosa phase vocoder
    out = librosa.effects.time_stretch(seg.astype(np.float32), rate=rate)
    return out.astype(np.float32)


def _apply_fades(seg2d: np.ndarray, cf: int) -> np.ndarray:
    """
    Apply fade-in/out windows to segment edges to reduce clicks.
    seg2d shape: (n, ch)
    """
    n = seg2d.shape[0]
    if cf <= 0 or n < 2 * cf + 8:
        return seg2d

    fade_in = np.linspace(0.0, 1.0, cf, dtype=np.float32)[:, None]
    fade_out = np.linspace(1.0, 0.0, cf, dtype=np.float32)[:, None]

    seg2d = seg2d.copy()
    seg2d[:cf] *= fade_in
    seg2d[-cf:] *= fade_out
    return seg2d


def _overlap_add(out: np.ndarray, seg: np.ndarray, cf: int) -> np.ndarray:
    """
    Overlap-add two segments with pre-applied fades.
    out, seg shapes: (n, ch)
    """
    if cf <= 0 or out.shape[0] < cf or seg.shape[0] < cf:
        return np.vstack([out, seg])

    # overlap region
    out_tail = out[-cf:]
    seg_head = seg[:cf]
    out[-cf:] = out_tail + seg_head
    return np.vstack([out, seg[cf:]])


def _normalize_peak(y2d: np.ndarray, headroom_db: float) -> np.ndarray:
    """
    Simple peak normalization to -headroom dBFS.
    This is NOT a true-peak limiter, but helps avoid clipping after processing.
    """
    if headroom_db is None:
        return y2d

    peak = float(np.max(np.abs(y2d))) if y2d.size else 0.0
    if peak <= 0.0:
        return y2d

    target = 10 ** (-float(headroom_db) / 20.0)  # e.g. -1 dB => 0.891
    if peak > target:
        y2d = y2d * (target / peak)
    return y2d


def warp_to_grid(
    y: np.ndarray,
    sr: int,
    src_beats: List[float],
    dst_beats: List[float],
    options: Optional[WarpOptions] = None,
) -> np.ndarray:
    """
    Warp audio so that beats at src_beats map to dst_beats.
    - Preserves pitch (time-stretch)
    - Piecewise per-beat segment
    - Stereo-safe: same timing for all channels

    Parameters
    ----------
    y : np.ndarray
        Audio samples. Shape (n,) or (n, ch). dtype float recommended (-1..1).
    sr : int
        Sample rate.
    src_beats : List[float]
        Original beat times in seconds.
    dst_beats : List[float]
        Target beat times in seconds (same length as src_beats).
    options : WarpOptions
        Engine/crossfade/headroom settings.

    Returns
    -------
    np.ndarray
        Warped audio with shape (n, ch) if input was 2D, or (n,) if input was mono.
    """
    if options is None:
        options = WarpOptions()

    engine = _choose_engine(options.engine)

    if len(src_beats) != len(dst_beats):
        raise ValueError("src_beats and dst_beats must have the same length.")
    if len(src_beats) < 4:
        raise ValueError("Need at least 4 beats to warp reliably.")

    y2d = _to_2d(y).astype(np.float32)
    n_samples, n_ch = y2d.shape

    # Crossfade length in samples
    cf = int(max(0, options.crossfade_ms) / 1000.0 * sr)
    cf = int(np.clip(cf, 0, int(0.02 * sr)))  # max 20ms

    min_seg = int(max(1, options.min_seg_ms) / 1000.0 * sr)

    src = np.array(src_beats, dtype=np.float64)
    dst = np.array(dst_beats, dtype=np.float64)

    # Ensure strictly increasing (beat trackers sometimes duplicate)
    # We drop non-increasing beats to avoid negative/zero segments.
    keep = np.ones(len(src), dtype=bool)
    for i in range(1, len(src)):
        if src[i] <= src[i - 1] + 1e-6 or dst[i] <= dst[i - 1] + 1e-6:
            keep[i] = False

    src = src[keep]
    dst = dst[keep]
    if len(src) < 4:
        raise RuntimeError("Too many invalid/non-increasing beats after cleaning.")

    out = np.zeros((0, n_ch), dtype=np.float32)

    # Process each interval [beat_i, beat_{i+1}]
    for i in range(len(src) - 1):
        a0, a1 = float(src[i]), float(src[i + 1])
        b0, b1 = float(dst[i]), float(dst[i + 1])

        in_dur = max(1e-6, a1 - a0)
        out_dur = max(1e-6, b1 - b0)

        s0 = int(round(a0 * sr))
        s1 = int(round(a1 * sr))
        s0 = int(np.clip(s0, 0, n_samples))
        s1 = int(np.clip(s1, 0, n_samples))

        if s1 <= s0:
            continue

        seg = y2d[s0:s1]  # (nseg, ch)

        # If segment is too short, skip stretching to avoid garbage artifacts
        if seg.shape[0] < min_seg:
            seg2 = seg
        else:
            # We want seg duration -> out_dur
            # Define rate as in_len / out_len
            rate = in_dur / out_dur

            # Stretch each channel with the same rate
            stretched_channels = []
            for ch in range(n_ch):
                stretched = _time_stretch_1ch(seg[:, ch], sr, rate, engine)
                stretched_channels.append(stretched)

            # Align channels to same length (engine may produce +/-1 samples diff)
            min_len = min(map(len, stretched_channels))
            seg2 = np.stack([c[:min_len] for c in stretched_channels], axis=1)

        # Edge fades + overlap-add
        seg2 = _apply_fades(seg2, cf)
        if out.shape[0] == 0:
            out = seg2
        else:
            out = _overlap_add(out, seg2, cf)

    out = _normalize_peak(out, options.headroom_db)

    # Return in original dimensionality
    if y.ndim == 1:
        return out[:, 0]
    return out
