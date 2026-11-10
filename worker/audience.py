"""Simulated audience: viewer archetypes with different sensitivities.

These are simulated viewing preferences, NOT measurements of real people.
Each archetype multiplies the global signal coefficients, so a niche expert
reacts more strongly to repeated information and a loyal fan barely reacts to
a slow intro. The numbers are heuristics until train.py calibrates them.
"""
from __future__ import annotations

import numpy as np

ARCHETYPES = [
    {"id": "impatient", "label": "Impatient viewer", "desc": "Needs an immediate reason to continue",
     "patience": 1.5, "sens": {"weak_hook": 1.6, "stagnation": 1.4, "dead_air": 1.4, "low_novelty": 1.2,
                                "repetition": 1.3, "slow_pacing": 1.5, "overload": 0.6, "ending_drag": 1.2}},
    {"id": "casual_scroller", "label": "Casual scroller", "desc": "Mild interest, little context",
     "patience": 1.3, "sens": {"weak_hook": 1.4, "stagnation": 1.2, "dead_air": 1.1, "low_novelty": 1.0,
                                "repetition": 1.0, "slow_pacing": 1.1, "overload": 1.1, "ending_drag": 1.0}},
    {"id": "new_viewer", "label": "New viewer", "desc": "Needs clear explanations",
     "patience": 1.1, "sens": {"weak_hook": 1.2, "stagnation": 1.0, "dead_air": 1.0, "low_novelty": 0.8,
                                "repetition": 0.7, "slow_pacing": 0.8, "overload": 1.8, "ending_drag": 1.0}},
    {"id": "story_focused", "label": "Story-focused", "desc": "Wants tension and a payoff",
     "patience": 0.9, "sens": {"weak_hook": 1.0, "stagnation": 0.8, "dead_air": 0.9, "low_novelty": 1.3,
                                "repetition": 1.2, "slow_pacing": 0.9, "overload": 1.0, "ending_drag": 1.7}},
    {"id": "audio_focused", "label": "Audio-focused", "desc": "Sensitive to voice and sound",
     "patience": 1.0, "sens": {"weak_hook": 1.0, "stagnation": 0.7, "dead_air": 1.9, "low_novelty": 0.9,
                                "repetition": 1.0, "slow_pacing": 1.3, "overload": 1.0, "ending_drag": 1.0}},
    {"id": "niche_expert", "label": "Niche expert", "desc": "Recognizes familiar information",
     "patience": 0.9, "sens": {"weak_hook": 0.9, "stagnation": 0.9, "dead_air": 0.9, "low_novelty": 1.7,
                                "repetition": 1.7, "slow_pacing": 1.4, "overload": 0.5, "ending_drag": 1.1}},
    {"id": "high_intent", "label": "High-intent viewer", "desc": "Specifically wants this topic",
     "patience": 0.6, "sens": {"weak_hook": 0.7, "stagnation": 0.8, "dead_air": 0.8, "low_novelty": 1.2,
                                "repetition": 1.2, "slow_pacing": 1.0, "overload": 0.9, "ending_drag": 0.9}},
    {"id": "loyal_fan", "label": "Loyal fan", "desc": "Already likes this creator",
     "patience": 0.45, "sens": {"weak_hook": 0.5, "stagnation": 0.6, "dead_air": 0.6, "low_novelty": 0.7,
                                "repetition": 0.7, "slow_pacing": 0.6, "overload": 0.7, "ending_drag": 0.8}},
]

AUDIENCE_PRESETS = {
    "feed": {"label": "Shorts feed / browse (mostly strangers)",
             "mix": {"impatient": 0.22, "casual_scroller": 0.26, "new_viewer": 0.14, "story_focused": 0.1,
                     "audio_focused": 0.08, "niche_expert": 0.06, "high_intent": 0.08, "loyal_fan": 0.06}},
    "subscribers": {"label": "Existing subscribers",
                    "mix": {"impatient": 0.08, "casual_scroller": 0.1, "new_viewer": 0.04, "story_focused": 0.14,
                            "audio_focused": 0.08, "niche_expert": 0.12, "high_intent": 0.12, "loyal_fan": 0.32}},
    "search": {"label": "Search / topic seekers",
               "mix": {"impatient": 0.12, "casual_scroller": 0.08, "new_viewer": 0.18, "story_focused": 0.06,
                       "audio_focused": 0.06, "niche_expert": 0.2, "high_intent": 0.26, "loyal_fan": 0.04}},
}

SIGNAL_TEXT = {
    "weak_hook": "Opening gives no clear reason to keep watching",
    "stagnation": "Visuals stay unchanged",
    "dead_air": "Near-silence / dead air",
    "low_novelty": "No new information",
    "repetition": "Repeats something already said",
    "slow_pacing": "Narration is slow",
    "overload": "Too fast to follow",
    "ending_drag": "Ending runs on after the payoff",
    "llm_disinterest": "AI reviewer flagged low interest",
}


def mix_vector(preset: str, custom: dict | None = None) -> np.ndarray:
    mix = dict(AUDIENCE_PRESETS.get(preset, AUDIENCE_PRESETS["feed"])["mix"])
    if custom:
        mix.update({k: float(v) for k, v in custom.items() if k in mix})
    v = np.array([max(0.0, mix.get(a["id"], 0.0)) for a in ARCHETYPES])
    return v / v.sum()


def sensitivity_matrix(signal_names: list[str]) -> np.ndarray:
    """A x K multipliers. Signals an archetype doesn't list (e.g. llm_disinterest) get 1.0."""
    return np.array([[a["sens"].get(k, 1.0) for k in signal_names] for a in ARCHETYPES])


def evidence_for(signal: str, seg: dict, rows: list[dict], hook: dict) -> str:
    o = seg["observations"]
    if signal == "stagnation":
        return f"No scene change for {o['longest_static_s']}s, motion {o['motion']:.3f}"
    if signal == "dead_air":
        return f"{round(o['silence_ratio'] * 100)}% of this stretch is near-silent"
    if signal == "low_novelty":
        if o["new_word_ratio"] is not None:
            return f"Only {round(o['new_word_ratio'] * 100)}% of spoken content words are new"
        return f"{o['scene_changes']} cuts and low motion: little new visual information"
    if signal == "repetition":
        rep = next((r["repeated"] for r in rows if r["repeated"] and seg["start"] - 0.5 <= r["t"] < seg["end"]), None)
        return f'Repeats "{rep["phrase"]}" (first said at {rep["first_said"]}s)' if rep else "Repeated phrase"
    if signal == "slow_pacing":
        return f"Narration around {o['speech_rate_wpm']} words per minute"
    if signal == "overload":
        return f"{o['speech_rate_wpm']} wpm with {o['scene_changes']} cuts in {seg['end'] - seg['start']:.1f}s"
    if signal == "weak_hook":
        bits = []
        bits.append(f"first cut at {hook['first_cut_at']}s" if hook["first_cut_at"] is not None else "no cut in the opening")
        if hook["first_word_at"] is not None:
            bits.append(f"first word at {hook['first_word_at']:.1f}s")
        bits.append("no curiosity words" if not hook["hook_words"] else f"uses \"{', '.join(hook['hook_words'])}\"")
        return ", ".join(bits)
    if signal == "ending_drag":
        return f"Final {seg['end'] - seg['start']:.1f}s add little new information"
    if signal == "llm_disinterest":
        return "Flagged by the multimodal reviewer"
    return ""


def reactions(contrib: np.ndarray, signal_names: list[str], segs: list[dict], rows: list[dict],
              hook: dict, transcript_source: str, llm_notes: dict | None = None) -> list[dict]:
    """Per archetype x segment structured reactions.

    contrib: A x T x K array of beta * sensitivity * (signal - center) contributions
    to the log-hazard. interest_score is an internal heuristic, not a probability.
    """
    out = []
    text_signals = {"low_novelty", "repetition", "slow_pacing"}
    for a_i, arch in enumerate(ARCHETYPES):
        for seg in segs:
            lo = int(seg["start"])
            hi = max(lo + 1, int(np.ceil(seg["end"])))
            c = contrib[a_i, lo:hi, :]
            if c.size == 0:
                continue
            eta = float(c.sum(axis=1).mean())
            per_sig = c.mean(axis=0)
            top = int(np.argmax(per_sig))
            hr = float(np.exp(eta))
            risk = "high" if hr >= 2.2 else "medium" if hr >= 1.5 else "low"
            sig = signal_names[top]
            confidence = "low" if (sig in text_signals and transcript_source != "whisper") else "medium"
            note = None
            if llm_notes:
                note = llm_notes.get((arch["id"], seg["index"]))
            out.append({
                "viewer_type": arch["id"],
                "segment_index": seg["index"],
                "timestamp": seg["start"],
                "interest_score": round(float(1 / (1 + np.exp(eta - 0.3))), 2),
                "dropout_risk": risk,
                "reason": (note or {}).get("reason") or (SIGNAL_TEXT[sig] if per_sig[top] > 0.05 else "Holding attention"),
                "evidence": (note or {}).get("evidence") or (evidence_for(sig, seg, rows, hook) if per_sig[top] > 0.05 else ""),
                "confidence": confidence,
            })
    return out
