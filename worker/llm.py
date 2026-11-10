"""Optional multimodal reviewer (Claude).

Runs only when ANTHROPIC_API_KEY (or another Anthropic credential) is set and
YTS_USE_LLM is not "0". It sees the measured segments, the transcript and a
handful of keyframes, then returns structured reactions for each archetype.

Its interest scores become one more signal (llm_disinterest) in the survival
model, so train.py can learn how much (if at all) the AI's opinion predicts
real behavior. It never writes the numbers on the dashboard by itself.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from audience import ARCHETYPES

MODEL = os.environ.get("YTS_LLM_MODEL", "claude-opus-5-5")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["video_summary", "opening_promise", "segments", "reactions", "recommendations"],
    "properties": {
        "video_summary": {"type": "string"},
        "opening_promise": {"type": "string"},
        "segments": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["index", "narrative_function", "interpretation"],
            "properties": {
                "index": {"type": "integer"},
                "narrative_function": {"type": "string", "enum": [
                    "hook", "setup", "build_up", "reveal", "payoff", "ending", "other"]},
                "interpretation": {"type": "string"},
            }}},
        "reactions": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["viewer_type", "segment_index", "interest_score", "dropout_risk", "reason", "evidence"],
            "properties": {
                "viewer_type": {"type": "string", "enum": [a["id"] for a in ARCHETYPES]},
                "segment_index": {"type": "integer"},
                "interest_score": {"type": "number"},
                "dropout_risk": {"type": "string", "enum": ["low", "medium", "high"]},
                "reason": {"type": "string"},
                "evidence": {"type": "string"},
            }}},
        "recommendations": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["start", "end", "issue", "fix"],
            "properties": {
                "start": {"type": "number"},
                "end": {"type": "number"},
                "issue": {"type": "string"},
                "fix": {"type": "string"},
            }}},
    },
}

SYSTEM = """You review unpublished short-form videos for a creator before upload.
You receive measured observations per segment (cuts, motion, silence, speech rate,
transcript) and keyframes. Treat measurements as ground truth and do not invent
events that aren't supported by them or by the frames.

For EVERY viewer archetype and EVERY segment, give a reaction: interest_score
from 0 (about to swipe away) to 1 (hooked), dropout_risk, a short reason, and the
concrete evidence (quote the transcript or cite the measurement). Be specific
and terse. Recommendations must name exact timestamps and a concrete edit
(what to cut, move, or add), never generic advice like "make the hook better"."""


def enabled() -> bool:
    if os.environ.get("YTS_USE_LLM", "1") == "0":
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def review(meta: dict, duration: float, segs: list[dict], hook: dict, thumbs_dir: Path,
           thumbs: list[dict]) -> dict | None:
    import anthropic

    client = anthropic.Anthropic()
    content: list[dict] = []
    picks = thumbs[:: max(1, len(thumbs) // 10)][:10]
    for th in picks:
        data = base64.b64encode((thumbs_dir / th["file"]).read_bytes()).decode()
        content.append({"type": "text", "text": f"Frame at {th['t']}s"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}})
    brief = {
        "title": meta.get("title"),
        "target_audience": meta.get("audience", {}),
        "duration_seconds": round(duration, 1),
        "opening_measurements": hook,
        "viewer_archetypes": [{"id": a["id"], "label": a["label"], "description": a["desc"]} for a in ARCHETYPES],
        "segments": [{"index": s["index"], "start": s["start"], "end": s["end"],
                      "transcript": s["transcript"], "observations": s["observations"]} for s in segs],
    }
    content.append({"type": "text", "text": "Video data:\n" + json.dumps(brief)})

    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        print(f"[warn] LLM review stopped: {response.stop_reason}", flush=True)
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    return json.loads(text) if text else None


def to_signal(result: dict, segs: list[dict], T: int, mix: list[float]) -> list[float]:
    """Mix-weighted (1 - interest) per second."""
    weight = {a["id"]: mix[i] for i, a in enumerate(ARCHETYPES)}
    per_seg: dict[int, list[tuple[float, float]]] = {}
    for r in result.get("reactions", []):
        w = weight.get(r["viewer_type"], 0)
        per_seg.setdefault(r["segment_index"], []).append((w, min(1.0, max(0.0, float(r["interest_score"])))))
    sig = [0.5] * T
    for s in segs:
        vals = per_seg.get(s["index"])
        if not vals:
            continue
        tw = sum(w for w, _ in vals) or 1.0
        dis = sum(w * (1 - v) for w, v in vals) / tw
        for t in range(int(s["start"]), min(T, int(max(s["start"] + 1, round(s["end"]))))):
            sig[t] = round(dis, 3)
    return sig
