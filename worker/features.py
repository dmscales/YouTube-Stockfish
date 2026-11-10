"""Video intelligence: turn a video file into timestamped, *observable* features.

Everything in this module is measured, not interpreted. "No cut for 4.2s" is an
observation. "Boring" is an interpretation and lives in audience.py / llm.py.

Requires ffmpeg + ffprobe on PATH and numpy. Speech-to-text is optional
(faster-whisper if installed, or a transcript the creator pastes in).
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
from pathlib import Path

import numpy as np

VISUAL_FPS = 4          # frames per second sampled for motion / cut detection
GRID = 48               # frames are downscaled to GRID x GRID grayscale
AUDIO_SR = 16000
AUDIO_HOP = AUDIO_SR // 10  # 100 ms audio frames

STOPWORDS = set(
    """a an the and or but so if then than that this these those is are was were be been being am
    i you he she it we they me him her us them my your his its our their what which who whom whose
    to of in on at by for with about from into over under up down out off again just very really
    do does did doing have has had having not no yes can could would should will shall may might
    there here when where why how all any both each few more most other some such only own same
    too s t don now get got like gonna wanna yeah okay ok oh um uh""".split()
)
HOOK_WORDS = set(
    """why how what never nobody secret wait watch stop look insane crazy impossible
    worst best first last only until changed everything happened mistake truth""".split()
)


def _run(cmd: list[str]) -> bytes:
    return subprocess.run(cmd, check=True, capture_output=True).stdout


# --------------------------------------------------------------------------- probe

def probe(path: str) -> dict:
    info = json.loads(_run(["ffprobe", "-v", "error", "-print_format", "json",
                            "-show_format", "-show_streams", path]))
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = float(info.get("format", {}).get("duration") or (v or {}).get("duration") or 0)
    if v is None:
        raise ValueError("File has no video stream")
    if duration <= 0:
        raise ValueError("Could not read video duration")
    return {
        "duration": duration,
        "width": int(v.get("width", 0)),
        "height": int(v.get("height", 0)),
        "has_audio": a is not None,
        "vertical": int(v.get("height", 0)) > int(v.get("width", 0)),
    }


# --------------------------------------------------------------------------- visual

def visual(path: str, duration: float) -> dict:
    raw = _run(["ffmpeg", "-v", "error", "-i", path, "-vf",
                f"fps={VISUAL_FPS},scale={GRID}:{GRID},format=gray",
                "-f", "rawvideo", "-"])
    px = np.frombuffer(raw, np.uint8)
    n = len(px) // (GRID * GRID)
    frames = px[: n * GRID * GRID].reshape(n, GRID, GRID).astype(np.float32) / 255.0
    if n < 2:
        return {"cuts": [], "motion": np.zeros(1), "frame_times": np.zeros(max(n, 1))}

    pix_diff = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    hists = np.stack([np.histogram(f, bins=16, range=(0, 1))[0] for f in frames]).astype(np.float32)
    hists /= hists.sum(axis=1, keepdims=True) + 1e-9
    hist_diff = 0.5 * np.abs(np.diff(hists, axis=0)).sum(axis=1)

    med = float(np.median(pix_diff))
    pix_thr = max(0.12, 5.0 * med)
    cuts: list[float] = []
    for i in range(len(pix_diff)):
        t = (i + 1) / VISUAL_FPS
        if hist_diff[i] > 0.35 or pix_diff[i] > pix_thr:
            if not cuts or t - cuts[-1] >= 0.5:
                cuts.append(round(t, 2))

    # motion = frame-to-frame change, ignoring the cut frames themselves
    motion = pix_diff.copy()
    for c in cuts:
        idx = int(round(c * VISUAL_FPS)) - 1
        if 0 <= idx < len(motion):
            motion[idx] = med
    return {"cuts": cuts, "motion": motion, "frames": frames}


def extract_thumbnails(path: str, duration: float, out_dir: Path, max_count: int = 24) -> list[dict]:
    """Small JPEG strip for the dashboard timeline (and keyframes for the LLM)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("t_*.jpg"):
        old.unlink()
    step = max(1.0, math.ceil(duration / max_count))
    _run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps=1/{step},scale=180:-2",
          "-q:v", "5", str(out_dir / "t_%03d.jpg")])
    thumbs = []
    for i, f in enumerate(sorted(out_dir.glob("t_*.jpg"))):
        thumbs.append({"t": round(i * step, 2), "file": f.name})
    return thumbs


# --------------------------------------------------------------------------- audio

def audio(path: str, has_audio: bool) -> dict:
    if not has_audio:
        return {"db": np.full(1, -90.0), "silent": np.ones(1, bool), "available": False}
    raw = _run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(AUDIO_SR),
                "-f", "s16le", "-"])
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    n = max(1, len(x) // AUDIO_HOP)
    x = x[: n * AUDIO_HOP].reshape(n, AUDIO_HOP) if len(x) >= AUDIO_HOP else np.zeros((1, AUDIO_HOP))
    rms = np.sqrt((x ** 2).mean(axis=1))
    db = 20 * np.log10(rms + 1e-6)
    loud = float(np.percentile(db, 95))
    silent = db < max(-50.0, loud - 30.0)
    return {"db": db, "silent": silent, "available": True}


def silence_runs(silent: np.ndarray, min_len_s: float = 0.6) -> list[dict]:
    runs, start = [], None
    for i, s in enumerate(list(silent) + [False]):
        if s and start is None:
            start = i
        elif not s and start is not None:
            length = (i - start) / 10
            if length >= min_len_s:
                runs.append({"start": round(start / 10, 1), "end": round(i / 10, 1)})
            start = None
    return runs


# --------------------------------------------------------------------------- transcript

def transcribe(path: str, provided_text: str | None, silent: np.ndarray, duration: float) -> dict:
    """Word-level transcript. Prefers faster-whisper; falls back to aligning a
    pasted transcript over the voiced parts of the audio (approximate)."""
    if os.environ.get("YTS_DISABLE_WHISPER") != "1":
        try:
            from faster_whisper import WhisperModel  # type: ignore

            model = WhisperModel(os.environ.get("WHISPER_MODEL", "base"), compute_type="int8")
            segs, _ = model.transcribe(path, word_timestamps=True)
            words = []
            for seg in segs:
                for w in seg.words or []:
                    words.append({"w": w.word.strip(), "start": float(w.start), "end": float(w.end)})
            return {"source": "whisper", "words": words}
        except ImportError:
            pass
        except Exception as exc:  # whisper failures shouldn't kill the analysis
            print(f"[warn] whisper failed: {exc}", flush=True)

    if provided_text and provided_text.strip():
        tokens = provided_text.split()
        voiced = ~silent
        if voiced.sum() < 3:
            voiced = np.ones_like(silent)
        voiced_idx = np.nonzero(voiced)[0]
        words = []
        for i, tok in enumerate(tokens):
            pos = voiced_idx[min(len(voiced_idx) - 1, int(i / len(tokens) * len(voiced_idx)))]
            start = min(duration, pos / 10)
            words.append({"w": tok, "start": round(start, 2), "end": round(start + 0.3, 2)})
        return {"source": "pasted_text_aligned_approx", "words": words}
    return {"source": "none", "words": []}


def _norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower())


# --------------------------------------------------------------------------- per-second table

def per_second(duration: float, vis: dict, aud: dict, transcript: dict) -> list[dict]:
    T = max(1, int(math.ceil(duration)))
    cuts = vis["cuts"]
    motion = vis["motion"]
    words = transcript["words"]
    has_speech = len(words) > 0

    seen: set[str] = set()
    rows = []
    last_change = 0.0
    phrase_first_seen: dict[tuple, float] = {}

    for t in range(T):
        lo, hi = t, min(t + 1, duration)
        sec_cuts = [c for c in cuts if lo <= c < hi]
        if sec_cuts:
            last_change = sec_cuts[-1]
        m_lo, m_hi = int(lo * VISUAL_FPS), max(int(lo * VISUAL_FPS) + 1, int(hi * VISUAL_FPS))
        mot = float(np.mean(motion[m_lo:m_hi])) if m_lo < len(motion) else 0.0

        a_lo, a_hi = int(lo * 10), max(int(lo * 10) + 1, int(hi * 10))
        db = aud["db"][a_lo:a_hi] if aud["available"] else np.array([-90.0])
        sil = aud["silent"][a_lo:a_hi] if aud["available"] else np.array([True])
        energy = float(np.mean(db)) if len(db) else -90.0
        silence_ratio = float(np.mean(sil)) if len(sil) else 1.0

        sec_words = [w for w in words if lo <= w["start"] < hi]
        win_words = [w for w in words if t - 1 <= w["start"] < t + 2]
        wpm = len(win_words) / 3 * 60 if has_speech else 0.0
        content = [_norm(w["w"]) for w in sec_words]
        content = [c for c in content if c and c not in STOPWORDS and len(c) > 2]
        new = [c for c in content if c not in seen]
        novelty = (len(new) / len(content)) if content else None
        seen.update(content)

        # repeated 3-word phrase (a line said twice)
        repeated = None
        idx0 = words.index(sec_words[0]) if sec_words else None
        if idx0 is not None:
            for k in range(idx0, idx0 + len(sec_words)):
                if k + 3 > len(words):
                    break
                key = tuple(_norm(words[j]["w"]) for j in range(k, k + 3))
                if not all(key):
                    continue
                first = phrase_first_seen.get(key)
                if first is None:
                    phrase_first_seen[key] = words[k]["start"]
                elif words[k]["start"] - first > 2 and repeated is None:
                    repeated = {"phrase": " ".join(words[j]["w"] for j in range(k, k + 3)),
                                "first_said": round(first, 1)}

        rows.append({
            "t": t,
            "cuts": len(sec_cuts),
            "since_change": round(hi - last_change, 2),
            "motion": round(mot, 4),
            "energy_db": round(energy, 1),
            "silence_ratio": round(silence_ratio, 2),
            "words": len(sec_words),
            "wpm": round(wpm),
            "novelty": None if novelty is None else round(novelty, 2),
            "text": " ".join(w["w"] for w in sec_words),
            "repeated": repeated,
            "hook_words": [c for c in content if c in HOOK_WORDS],
        })
    return rows


# --------------------------------------------------------------------------- signals

SIGNALS = ["weak_hook", "stagnation", "dead_air", "low_novelty", "repetition",
           "slow_pacing", "overload", "ending_drag"]


def _clip(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def hook_report(rows: list[dict], vis: dict, transcript: dict, aud: dict) -> dict:
    words = transcript["words"]
    first_word = words[0]["start"] if words else None
    first_cut = vis["cuts"][0] if vis["cuts"] else None
    first3 = rows[:3]
    motion3 = float(np.mean([r["motion"] for r in first3])) if first3 else 0
    hook_words = sorted({w for r in first3 for w in r["hook_words"]})
    sound_start = None
    if aud["available"]:
        voiced = np.nonzero(~aud["silent"])[0]
        sound_start = round(voiced[0] / 10, 1) if len(voiced) else None
    parts = [
        1.0 if (first_cut is not None and first_cut <= 2.0) or motion3 > 0.035 else 0.3 if motion3 > 0.015 else 0.0,
        (1.0 if first_word <= 0.7 else 0.5 if first_word <= 1.5 else 0.0) if first_word is not None
        else (0.6 if sound_start is not None and sound_start <= 0.5 else 0.0),
        1.0 if hook_words else 0.0 if words else 0.4,
    ]
    strength = float(np.mean(parts))
    return {"strength": round(strength, 2), "first_word_at": first_word, "first_cut_at": first_cut,
            "sound_starts_at": sound_start, "opening_motion": round(motion3, 4), "hook_words": hook_words}


def build_signals(rows: list[dict], duration: float, hook: dict, has_speech: bool, has_audio: bool) -> dict:
    """Convert observations to normalized [0, 1] risk signals per second.
    These are the features the prediction model (and train.py) uses."""
    T = len(rows)
    sig = {k: [0.0] * T for k in SIGNALS}
    end_zone = max(3.0, 0.2 * duration)
    for i, r in enumerate(rows):
        motion_n = _clip(r["motion"] / 0.04)
        sig["stagnation"][i] = _clip((r["since_change"] - 2.0) / 4.0) * (1 - 0.8 * motion_n)
        sig["dead_air"][i] = r["silence_ratio"] if has_audio else 0.6
        if r["novelty"] is not None:
            info = r["novelty"]
        elif has_speech:
            # silence inside a talking video: only visuals can carry new information
            info = _clip(r["cuts"] * 0.6 + motion_n * 0.5)
        else:
            info = _clip(r["cuts"] * 0.6 + motion_n * 0.6 + 0.2)
        sig["low_novelty"][i] = 1 - info
        sig["repetition"][i] = 1.0 if r["repeated"] else 0.0
        if r["words"] > 0 or (has_speech and r["wpm"] > 0):
            sig["slow_pacing"][i] = _clip((115 - r["wpm"]) / 60) if r["wpm"] > 0 else 0.0
        sig["overload"][i] = max(_clip((r["wpm"] - 220) / 60), _clip(r["cuts"] - 2))
        if i < 3:
            sig["weak_hook"][i] = 1 - hook["strength"]
        if r["t"] >= duration - end_zone and duration > 8:
            sig["ending_drag"][i] = _clip(0.7 * sig["low_novelty"][i] + 0.3 * sig["stagnation"][i])
    return {k: [round(v, 3) for v in vals] for k, vals in sig.items()}


# --------------------------------------------------------------------------- segments

def window(rows: list[dict], cuts: list[float], a: float, b: float, index: int = 0,
           duration: float | None = None) -> dict:
    """Observable summary of the stretch [a, b)."""
    sec = [r for r in rows if a - 0.5 <= r["t"] < b - 0.01] or rows[-1:]
    texts = [r["text"] for r in sec if r["text"]]
    nov = [r["novelty"] for r in sec if r["novelty"] is not None]
    dur = duration if duration is not None else len(rows)
    func = "hook" if a < 3 else "ending" if b >= dur - max(2.0, 0.15 * dur) else "build_up"
    return {
        "index": index,
        "start": round(a, 2),
        "end": round(b, 2),
        "transcript": " ".join(texts),
        "observations": {
            "scene_changes": sum(1 for c in cuts if a <= c < b),
            "longest_static_s": round(max(r["since_change"] for r in sec), 1),
            "speech_rate_wpm": round(float(np.mean([r["wpm"] for r in sec]))),
            "audio_energy_db": round(float(np.mean([r["energy_db"] for r in sec])), 1),
            "silence_ratio": round(float(np.mean([r["silence_ratio"] for r in sec])), 2),
            "motion": round(float(np.mean([r["motion"] for r in sec])), 4),
            "new_word_ratio": round(float(np.mean(nov)), 2) if nov else None,
        },
        "interpretation": {"narrative_function": func, "source": "heuristic"},
    }


def segments(rows: list[dict], cuts: list[float], duration: float, max_len: float = 6.0) -> list[dict]:
    bounds = [0.0] + [c for c in cuts if 0.8 < c < duration - 0.8] + [duration]
    spans = []
    for a, b in zip(bounds, bounds[1:]):
        while b - a > max_len:
            spans.append((a, a + max_len))
            a += max_len
        if b - a >= 0.5 or not spans:
            spans.append((a, b))
        else:
            spans[-1] = (spans[-1][0], b)
    return [window(rows, cuts, a, b, i, duration) for i, (a, b) in enumerate(spans)]
