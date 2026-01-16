import os
import uuid
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any

import aiofiles
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from beattogrid.analyze import analyze_audio
from beattogrid.grid import build_corrected_grid, GridSettings
from beattogrid.warp import warp_to_grid, WarpOptions

APP_ROOT = Path(__file__).parent.resolve()
STORAGE = APP_ROOT / "storage"
UPLOADS = STORAGE / "uploads"
OUTPUTS = STORAGE / "outputs"

FFMPEG_EXE = os.environ.get("FFMPEG_EXE") or shutil.which("ffmpeg")
RUBBERBAND_EXE = os.environ.get("RUBBERBAND_EXE") or shutil.which("rubberband")

# Ensure rubberband is discoverable by subprocess calls inside pyrubberband
if RUBBERBAND_EXE:
    rb_dir = str(Path(RUBBERBAND_EXE).parent)
    os.environ["PATH"] = rb_dir + os.pathsep + os.environ.get("PATH", "")


for d in (UPLOADS, OUTPUTS):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="BeatToGrid")

# serve frontend
app.mount("/web", StaticFiles(directory=str(APP_ROOT / "web"), html=True), name="web")

# naive in-memory job store (ok voor lokaal)
JOBS: Dict[str, Dict[str, Any]] = {}


def _ffmpeg_to_wav(in_path: Path, out_path: Path):
    if not FFMPEG_EXE:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg.exe niet gevonden. Zet FFMPEG_EXE env var of voeg ffmpeg toe aan PATH."
        )

    cmd = [
        FFMPEG_EXE, "-y",
        "-i", str(in_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)



def _ensure_wav(path: Path) -> Path:
    if path.suffix.lower() == ".wav":
        return path
    wav_path = path.with_suffix(".wav")
    _ffmpeg_to_wav(path, wav_path)
    return wav_path


class AnalyzeResponse(BaseModel):
    job_id: str
    bpm_estimate: float
    beats: list[float]


class ProcessRequest(BaseModel):
    job_id: str
    target_bpm: Optional[float] = None
    strength: float = 0.7
    anchor_time: float  # seconds: user clicked downbeat
    crossfade_ms: int = 10
    engine: str = "auto"


class ProcessResponse(BaseModel):
    job_id: str
    output_file: str


@app.post("/api/upload", response_model=AnalyzeResponse)
async def upload(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())
    job_dir = UPLOADS / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    in_path = job_dir / file.filename
    async with aiofiles.open(in_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            await f.write(chunk)

    JOBS[job_id] = {"status": "uploaded", "input": str(in_path)}

    try:
        wav_path = _ensure_wav(in_path)
        JOBS[job_id]["wav"] = str(wav_path)
        JOBS[job_id]["status"] = "analyzing"

        analysis = analyze_audio(str(wav_path))
        JOBS[job_id]["analysis"] = analysis
        JOBS[job_id]["status"] = "ready"

        return AnalyzeResponse(
            job_id=job_id,
            bpm_estimate=analysis.bpm_estimate,
            beats=analysis.beats,
        )
    except Exception as e:
        JOBS[job_id]["status"] = "error"
        JOBS[job_id]["error"] = str(e)
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/status/{job_id}")
def status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job_id")
    return {"job_id": job_id, "status": job.get("status"), "error": job.get("error")}


@app.post("/api/process", response_model=ProcessResponse)
def process(req: ProcessRequest):
    job = JOBS.get(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job_id")
    if job.get("status") not in ("ready", "processed"):
        raise HTTPException(status_code=400, detail=f"Job not ready (status={job.get('status')})")

    analysis = job["analysis"]
    wav_path = Path(job["wav"])

    job["status"] = "processing"

    # choose target bpm
    target_bpm = float(req.target_bpm) if req.target_bpm else round(float(analysis.bpm_estimate))

    # find nearest beat index to clicked anchor_time
    beats = analysis.beats
    anchor_idx = min(range(len(beats)), key=lambda i: abs(beats[i] - req.anchor_time))

    corrected = build_corrected_grid(
        analysis,
        GridSettings(target_bpm=target_bpm, strength=float(req.strength), anchor_beat_index=int(anchor_idx))
    )

    # load audio for warping (stereo)
    y, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)

    out = warp_to_grid(
        y=y,
        sr=sr,
        src_beats=analysis.beats,
        dst_beats=corrected,
        options=WarpOptions(engine=req.engine, crossfade_ms=int(req.crossfade_ms), headroom_db=1.0)
    )

    out_name = f"{wav_path.stem}_straight_{target_bpm:.2f}.wav"
    out_path = OUTPUTS / req.job_id
    out_path.mkdir(parents=True, exist_ok=True)
    final_path = out_path / out_name

    sf.write(str(final_path), out, sr, subtype="PCM_16")

    job["status"] = "processed"
    job["output"] = str(final_path)

    return ProcessResponse(job_id=req.job_id, output_file=out_name)


@app.get("/api/download/{job_id}")
def download(job_id: str):
    job = JOBS.get(job_id)
    if not job or job.get("status") != "processed":
        raise HTTPException(status_code=404, detail="No processed output for this job.")
    path = job["output"]
    return FileResponse(path, filename=os.path.basename(path), media_type="audio/wav")
