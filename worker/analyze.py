#!/usr/bin/env python3
"""Analyze one uploaded video.

    python3 worker/analyze.py --dir data/videos/<id>              # full analysis
    python3 worker/analyze.py --dir data/videos/<id> --repredict  # re-run prediction only

Reads <dir>/meta.json and <dir>/source.*; writes <dir>/status.json,
<dir>/analysis.json and <dir>/thumbs/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import traceback
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import audience  # noqa: E402
import features  # noqa: E402
import llm  # noqa: E402
import predict  # noqa: E402
import recommend  # noqa: E402

MAX_SECONDS = 15 * 60


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class Status:
    def __init__(self, d: Path):
        self.path = d / "status.json"

    def set(self, state: str, stage: str, progress: float, error: str | None = None):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"state": state, "stage": stage, "progress": round(progress, 2),
                                   "error": error, "updated_at": now()}))
        tmp.replace(self.path)


def r3(a) -> list[float]:
    return [round(float(x), 4) for x in a]


def run_prediction(an: dict, meta: dict) -> dict:
    params = predict.load_params()
    aud = meta.get("audience") or {}
    preset = aud.get("preset", "feed")
    mix = audience.mix_vector(preset, aud.get("mix"))
    duration = an["video"]["duration"]
    signals = an["signals"]
    sim = predict.simulate(signals, duration, mix, params)

    moments = predict.risk_moments(sim, mix)
    windows = [features.window(an["per_second"], an["cuts"], m["start"], m["end"], duration=duration)
               for m in moments]
    gains = []
    for m in moments:
        g = {}
        for s in m["signals"]:
            g[s] = predict.counterfactual_gain(signals, duration, mix, params, s, m["start"], m["end"],
                                               sim["avg_viewed"])
        gains.append(g)
    recs = recommend.build(moments, windows, an["hook"], an["per_second"], gains)
    for r in (an.get("llm") or {}).get("recommendations", []):
        recs.append({"start": r["start"], "end": r["end"], "severity": "info", "signal": "llm",
                     "title": f"{recommend.ts(r['start'])} - AI reviewer", "why": r["issue"], "fix": r["fix"],
                     "affected": [], "est_gain_pp": None, "source": "ai_reviewer"})

    llm_notes = None
    if an.get("llm"):
        llm_notes = {(x["viewer_type"], x["segment_index"]): x for x in an["llm"].get("reactions", [])}
    reacts = audience.reactions(sim["contrib"], sim["signal_names"], an["segments"], an["per_second"],
                                an["hook"], an["transcript"]["source"], llm_notes)

    R = sim["curve"]
    loss3 = 1 - R[min(3, len(R) - 1)]
    base3 = 1 - sim["baseline_curve"][min(3, len(R) - 1)]
    ratio = loss3 / max(base3, 1e-6)
    opening = "High" if ratio > 1.15 else "Low" if ratio < 0.9 else "Medium"
    samples = sim["avg_viewed_samples"]
    interest = 1 / (1 + np.exp(sim["eta"] - 0.3))

    return {
        "model_version": params.get("version"),
        "model_trained": bool(params.get("trained")),
        "format": sim["format"],
        "audience_preset": preset,
        "audience_label": audience.AUDIENCE_PRESETS.get(preset, audience.AUDIENCE_PRESETS["feed"])["label"],
        "mix": {a["id"]: round(float(mix[i]), 3) for i, a in enumerate(audience.ARCHETYPES)},
        "curve": r3(R),
        "curve_p10": r3(sim["curve_p10"]),
        "curve_p90": r3(sim["curve_p90"]),
        "baseline_curve": r3(sim["baseline_curve"]),
        "archetype_curves": {a["id"]: r3(sim["archetype_curves"][i]) for i, a in enumerate(audience.ARCHETYPES)},
        "avg_viewed": round(sim["avg_viewed"], 4),
        "avg_viewed_p10": round(float(np.percentile(samples, 10)), 4),
        "avg_viewed_p90": round(float(np.percentile(samples, 90)), 4),
        "avg_viewed_samples": r3(samples),
        "baseline_avg_viewed": round(sim["baseline_avg_viewed"], 4),
        "watch_seconds": round(sim["avg_viewed"] * duration, 1),
        "finish_rate": round(float(R[-1]), 4),
        "opening_risk": opening,
        "opening_loss": round(float(loss3), 4),
        "baseline_opening_loss": round(float(base3), 4),
        "moments": moments,
        "recommendations": recs,
        "reactions": reacts,
        "interest_heatmap": {a["id"]: [round(float(x), 2) for x in interest[i]] for i, a in enumerate(audience.ARCHETYPES)},
        "predicted_at": now(),
    }


def full(d: Path, st: Status):
    meta = json.loads((d / "meta.json").read_text())
    src = next(d.glob("source.*"))
    st.set("processing", "Reading video", 0.05)
    info = features.probe(str(src))
    if info["duration"] > MAX_SECONDS:
        raise ValueError(f"Video is {info['duration']:.0f}s; the MVP supports up to {MAX_SECONDS // 60} minutes")
    duration = info["duration"]

    st.set("processing", "Detecting scenes and motion", 0.15)
    vis = features.visual(str(src), duration)
    st.set("processing", "Extracting keyframes", 0.3)
    thumbs = features.extract_thumbnails(str(src), duration, d / "thumbs")
    st.set("processing", "Analyzing audio", 0.4)
    aud = features.audio(str(src), info["has_audio"])
    st.set("processing", "Transcribing speech", 0.5)
    transcript = features.transcribe(str(src), meta.get("transcript_text"), aud["silent"], duration)

    st.set("processing", "Building timeline", 0.6)
    rows = features.per_second(duration, vis, aud, transcript)
    hook = features.hook_report(rows, vis, transcript, aud)
    signals = features.build_signals(rows, duration, hook, bool(transcript["words"]), aud["available"])
    segs = features.segments(rows, vis["cuts"], duration)

    an = {
        "schema": 1,
        "analyzed_at": now(),
        "video": {**info},
        "transcript": transcript,
        "hook": hook,
        "cuts": vis["cuts"],
        "silences": features.silence_runs(aud["silent"]) if aud["available"] else [],
        "thumbs": thumbs,
        "per_second": rows,
        "signals": signals,
        "segments": segs,
        "llm": None,
        "warnings": [],
    }
    if transcript["source"] == "none":
        an["warnings"].append("No transcript: install faster-whisper or paste the script, "
                              "otherwise speech-based signals (novelty, repetition, pacing) are approximated from visuals.")
    elif transcript["source"] != "whisper":
        an["warnings"].append("Transcript timing is approximated from the audio; word-level timestamps need faster-whisper.")

    if llm.enabled():
        st.set("processing", "AI audience review", 0.7)
        try:
            mix = audience.mix_vector((meta.get("audience") or {}).get("preset", "feed"))
            res = llm.review(meta, duration, segs, hook, d / "thumbs", thumbs)
            if res:
                an["llm"] = res
                an["signals"]["llm_disinterest"] = llm.to_signal(res, segs, len(rows), list(mix))
                for s in res.get("segments", []):
                    if 0 <= s["index"] < len(segs):
                        segs[s["index"]]["interpretation"] = {
                            "narrative_function": s["narrative_function"],
                            "note": s["interpretation"], "source": "ai_reviewer"}
        except Exception as exc:
            an["warnings"].append(f"AI review skipped: {type(exc).__name__}: {exc}")
    else:
        an["warnings"].append("AI reviewer off (no ANTHROPIC_API_KEY). Audience reactions are rule-based.")

    st.set("processing", "Simulating audience and predicting retention", 0.85)
    an["prediction"] = run_prediction(an, meta)
    (d / "analysis.json").write_text(json.dumps(an))


def repredict(d: Path, st: Status):
    meta = json.loads((d / "meta.json").read_text())
    an = json.loads((d / "analysis.json").read_text())
    st.set("processing", "Re-running prediction", 0.5)
    an["prediction"] = run_prediction(an, meta)
    (d / "analysis.json").write_text(json.dumps(an))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--repredict", action="store_true")
    args = ap.parse_args()
    d = Path(args.dir)
    st = Status(d)
    try:
        (repredict if args.repredict else full)(d, st)
        st.set("done", "Complete", 1.0)
    except Exception as exc:
        traceback.print_exc()
        st.set("failed", "Failed", 1.0, f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
