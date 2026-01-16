import argparse
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from beattogrid.analyze import analyze_audio
from beattogrid.grid import build_corrected_grid, GridSettings
from beattogrid.warp import warp_to_grid, WarpOptions


def ensure_wav(input_path: str) -> str:
    ext = os.path.splitext(input_path)[1].lower()
    if ext == ".wav":
        return input_path

    # Convert to WAV using ffmpeg
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        tmp.name
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return tmp.name


def main():
    p = argparse.ArgumentParser(description="Beat-to-grid: straighten beat timing for DJ sync.")
    p.add_argument("input", help="Input audio file (mp3/wav)")
    p.add_argument("--bpm", type=float, default=None, help="Target BPM (default: rounded estimate)")
    p.add_argument("--strength", type=float, default=0.7, help="0.0..1.0 (default 0.7)")
    p.add_argument("--crossfade-ms", type=int, default=10, help="Crossfade in ms (default 10)")
    p.add_argument("--engine", choices=["auto", "rubberband", "librosa"], default="auto")
    p.add_argument("--out", default=None, help="Output wav path (default: <name>_straight.wav)")
    args = p.parse_args()

    wav_path = ensure_wav(args.input)

    # Analysis
    analysis = analyze_audio(wav_path)
    target_bpm = args.bpm if args.bpm else round(analysis.bpm_estimate)

    # Build corrected grid
    corrected = build_corrected_grid(
        analysis,
        GridSettings(target_bpm=float(target_bpm), strength=float(args.strength), anchor_beat_index=0)
    )

    # Load original WAV (stereo) for warping
    y, sr = sf.read(wav_path, dtype="float32", always_2d=False)

    out = warp_to_grid(
        y=y,
        sr=sr,
        src_beats=analysis.beats,
        dst_beats=corrected,
        options=WarpOptions(engine=args.engine, crossfade_ms=args.crossfade_ms, headroom_db=1.0)
    )

    # Output path
    if args.out:
        out_path = args.out
    else:
        base = os.path.splitext(os.path.basename(args.input))[0]
        out_path = f"{base}_straight_{target_bpm:.2f}.wav"

    sf.write(out_path, out, sr, subtype="PCM_16")
    print(f"OK: wrote {out_path}")

    # Cleanup temp wav if created
    if wav_path != args.input and os.path.exists(wav_path):
        os.remove(wav_path)


if __name__ == "__main__":
    main()
