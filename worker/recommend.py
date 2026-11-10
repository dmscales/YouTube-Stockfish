"""Turn risk moments into specific, timestamped edit suggestions."""
from __future__ import annotations

from audience import ARCHETYPES, SIGNAL_TEXT


def ts(sec: float) -> str:
    sec = max(0, int(round(sec)))
    return f"{sec // 60:02d}:{sec % 60:02d}"


LABELS = {a["id"]: a["label"] for a in ARCHETYPES}


def _fix(signal: str, w: dict, hook: dict, rows: list[dict]) -> tuple[str, str]:
    o = w["observations"]
    a, b = w["start"], w["end"]
    span = f"{ts(a)}-{ts(b)}"
    if signal == "weak_hook":
        issues = []
        if hook["first_cut_at"] is None or hook["first_cut_at"] > 2:
            issues.append("no visual change in the first 2 seconds")
        if hook["first_word_at"] is not None and hook["first_word_at"] > 0.7:
            issues.append(f"the first word lands at {hook['first_word_at']:.1f}s")
        if not hook["hook_words"]:
            issues.append("the opening line doesn't open a question")
        why = "The opening has " + (", ".join(issues) if issues else "little to grab a stranger") + "."
        return why, ("Start on the most surprising frame of the video, get the first word in by 0.3s, "
                     "and state the question or stakes in the first sentence.")
    if signal == "stagnation":
        hold = o["longest_static_s"]
        return (f"The shot holds for {hold}s with little motion ({span}).",
                f"Cut {max(1.0, round(hold - 2.0, 1))}s from this shot, or add a punch-in, B-roll or on-screen text around {ts((a + b) / 2)}.")
    if signal == "dead_air":
        return (f"{round(o['silence_ratio'] * 100)}% of {span} is near-silent.",
                "Close the gap in the edit, or cover it with a sound effect, music hit or the next line of narration.")
    if signal == "low_novelty":
        if o["new_word_ratio"] is not None:
            quote = w["transcript"][:90]
            return (f'Narration here mostly restates earlier points ("{quote}").',
                    f"Remove or compress {span} and move the next new piece of information earlier.")
        return (f"Nothing new is shown or said during {span}.",
                f"Shorten {span} or introduce the next reveal here.")
    if signal == "repetition":
        rep = next((r["repeated"] for r in rows if r["repeated"] and a - 0.5 <= r["t"] < b), None)
        if rep:
            return (f'"{rep["phrase"]}" was already said at {ts(rep["first_said"])}.',
                    f"Delete the repeated line at {ts(a)}; viewers already have that information.")
        return ("A line repeats earlier information.", f"Delete the repeat at {ts(a)}.")
    if signal == "slow_pacing":
        return (f"Narration slows to about {o['speech_rate_wpm']} words per minute.",
                "Tighten pauses between sentences (jump cuts) or re-record this line with more energy.")
    if signal == "overload":
        return (f"{o['speech_rate_wpm']} wpm and {o['scene_changes']} cuts in {b - a:.0f}s may be hard to follow for new viewers.",
                "Give one beat to breathe or add a caption that names what's happening.")
    if signal == "ending_drag":
        return (f"After the payoff, {span} adds little new.",
                f"End the video closer to {ts(a)}, or save a final twist for the last second so the loop feels earned.")
    return (SIGNAL_TEXT.get(signal, signal), "Review this section.")


def build(moments: list[dict], windows: list[dict], hook: dict, rows: list[dict], gains: list[dict]) -> list[dict]:
    recs = []
    for m, w, g in zip(moments, windows, gains):
        sig = m["signals"][0]
        why, fix = _fix(sig, w, hook, rows)
        recs.append({
            "start": m["start"],
            "end": m["end"],
            "severity": m["severity"],
            "signal": sig,
            "title": f"{ts(m['start'])} - {SIGNAL_TEXT.get(sig, sig)}",
            "why": why,
            "fix": fix,
            "affected": [LABELS[x] for x in m["affected"]],
            "est_gain_pp": g.get(sig, 0.0),
            "source": "heuristic",
        })
    recs.sort(key=lambda r: -r["est_gain_pp"])
    return recs
