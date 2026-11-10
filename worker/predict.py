"""Retention prediction engine: a discrete-time survival model.

R(t) = P(T >= t), where T is the second a viewer stops watching.
For each archetype a and second t the hazard is

    h_a(t) = 1 - exp(-lambda0(t) * patience_a * exp(eta_a(t)))
    eta_a(t) = sum_k beta_k * sens_{a,k} * (signal_k(t) - center_k)

lambda0 comes from a duration-aware baseline (a "typical" video of that
length). The audience curve is the mix-weighted average of archetype curves.
Uncertainty comes from Monte Carlo draws over the coefficients, the baseline
level and the audience mix. Draws use a fixed seed so two analyses are
compared on paired draws (see compare in the web app).

Until train.py fits the coefficients to real retention data, every number
here is an experimental heuristic, and the bands are deliberately wide.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np

from audience import ARCHETYPES, sensitivity_matrix

ALL_SIGNALS = ["weak_hook", "stagnation", "dead_air", "low_novelty", "repetition",
               "slow_pacing", "overload", "ending_drag", "llm_disinterest"]
N_DRAWS = 200
SEED = 20240611
HERE = Path(__file__).resolve().parent


def data_dir() -> Path:
    return Path(os.environ.get("YTS_DATA_DIR", HERE.parent / "data"))


def load_params() -> dict:
    trained = data_dir() / "model_params.json"
    path = trained if trained.exists() else HERE / "model_defaults.json"
    return json.loads(path.read_text())


def baseline_hazard(T: int, duration: float, params: dict) -> tuple[np.ndarray, str]:
    kind = "short" if duration <= params["short_max_seconds"] else "long"
    b = params["baseline"][kind]
    t = np.arange(T)
    h0 = params.get("baseline_scale", 1.0) * (b["A"] * np.exp(-t / b["tau"]) + b["B"])
    return np.clip(h0, 1e-5, 0.95), kind


def design(signals: dict, params: dict, T: int) -> tuple[list[str], np.ndarray]:
    """T x K matrix of centered signals."""
    names = [k for k in ALL_SIGNALS if k in signals]
    X = np.array([signals[k][:T] for k in names], dtype=float).T
    C = np.tile(np.array([params["centers"].get(k, 0.0) for k in names]), (T, 1))
    if "weak_hook" in names:
        C[3:, names.index("weak_hook")] = 0.0
    return names, X - C


def _curves(lam0: np.ndarray, patience: np.ndarray, eta: np.ndarray):
    """eta: (..., A, T) -> survival R (..., A, T+1) and hazard h (..., A, T)."""
    h = 1.0 - np.exp(-lam0 * patience[:, None] * np.exp(np.clip(eta, -6, 6)))
    h = np.clip(h, 0.0, 0.98)
    R = np.concatenate([np.ones(h.shape[:-1] + (1,)), np.cumprod(1 - h, axis=-1)], axis=-1)
    return R, h


def _avg_viewed(R: np.ndarray, duration: float, T: int) -> np.ndarray:
    """Average fraction of the video viewed (trapezoid over the survival curve)."""
    seg = (R[..., :-1] + R[..., 1:]) / 2
    widths = np.ones(T)
    widths[-1] = max(0.05, duration - (T - 1))
    return (seg * widths).sum(axis=-1) / duration


def simulate(signals: dict, duration: float, mix: np.ndarray, params: dict, draws: bool = True) -> dict:
    T = len(next(iter(signals.values())))
    h0, kind = baseline_hazard(T, duration, params)
    lam0 = -np.log(1 - h0)
    names, X = design(signals, params, T)
    beta = np.array([params["betas"].get(k, 0.0) for k in names])
    sens = sensitivity_matrix(names)                       # A x K
    patience = np.array([a["patience"] for a in ARCHETYPES])

    contrib = np.einsum("k,ak,tk->atk", beta, sens, X)     # A x T x K
    eta = contrib.sum(axis=-1)                              # A x T
    R_a, h_a = _curves(lam0, patience, eta)
    R_base_a, h_base_a = _curves(lam0, patience, np.zeros_like(eta))
    R = mix @ R_a
    R_base = mix @ R_base_a

    out = {
        "format": kind,
        "signal_names": names,
        "curve": R,
        "baseline_curve": R_base,
        "archetype_curves": R_a,
        "avg_viewed": float(_avg_viewed(R, duration, T)),
        "baseline_avg_viewed": float(_avg_viewed(R_base, duration, T)),
        "contrib": contrib,
        "eta": eta,
        "R_a": R_a,
        "h_a": h_a,
        "h_base_a": h_base_a,
    }
    if not draws:
        return out

    unc = params["uncertainty"]
    rng = np.random.default_rng(SEED)
    zb = rng.standard_normal((N_DRAWS, len(ALL_SIGNALS)))
    z0 = rng.standard_normal(N_DRAWS)
    conc = unc["mix_concentration"]
    mixes = np.stack([rng.dirichlet(np.maximum(mix * conc, 1e-3)) for _ in range(N_DRAWS)])
    cols = [ALL_SIGNALS.index(k) for k in names]
    B = beta[None, :] * np.exp(unc["beta_sigma"] * zb[:, cols])       # N x K
    scale = np.exp(unc["baseline_sigma"] * z0)                          # N
    eta_n = np.einsum("nk,ak,tk->nat", B, sens, X)
    lam_n = -np.log(1 - np.clip(h0[None, :] * scale[:, None], 1e-5, 0.95))  # N x T
    h_n = 1.0 - np.exp(-lam_n[:, None, :] * patience[None, :, None] * np.exp(np.clip(eta_n, -6, 6)))
    h_n = np.clip(h_n, 0, 0.98)
    R_n = np.concatenate([np.ones((N_DRAWS, len(ARCHETYPES), 1)), np.cumprod(1 - h_n, axis=-1)], axis=-1)
    R_mix_n = np.einsum("na,nat->nt", mixes, R_n)
    avg_n = _avg_viewed(R_mix_n, duration, T)
    out.update({
        "curve_p10": np.percentile(R_mix_n, 10, axis=0),
        "curve_p90": np.percentile(R_mix_n, 90, axis=0),
        "avg_viewed_samples": avg_n,
    })
    return out


def risk_moments(sim: dict, mix: np.ndarray, max_moments: int = 6) -> list[dict]:
    R_a, h_a, hb_a = sim["R_a"], sim["h_a"], sim["h_base_a"]
    T = h_a.shape[1]
    w = mix[:, None] * R_a[:, :T]                   # survivors per archetype at start of second
    R = w.sum(axis=0)
    h = (w * h_a).sum(axis=0) / R
    hb = (w * hb_a).sum(axis=0) / R
    excess = R * (h - hb)                             # share of the audience lost beyond "typical"
    hr = h / np.maximum(hb, 1e-6)
    contrib_mix = np.einsum("at,atk->tk", w / R, sim["contrib"])

    flagged = [t for t in range(T) if hr[t] >= 1.35 and excess[t] > 0]
    groups: list[list[int]] = []
    for t in flagged:
        if groups and t - groups[-1][-1] <= 1:
            groups[-1].append(t)
        else:
            groups.append([t])
    moments = []
    for g in groups:
        lo, hi = g[0], g[-1] + 1
        lost = float(excess[lo:hi].clip(min=0).sum())
        if lost < 0.003:
            continue
        sig_sum = contrib_mix[lo:hi].clip(min=0).sum(axis=0)
        order = np.argsort(-sig_sum)
        top = [sim["signal_names"][i] for i in order[:2] if sig_sum[i] > 0.05]
        if not top:
            continue
        aff = np.argsort(-sim["eta"][:, lo:hi].mean(axis=1))[:3]
        moments.append({
            "start": lo, "end": hi,
            "peak_hazard_ratio": round(float(hr[lo:hi].max()), 2),
            "excess_loss_pct": round(lost * 100, 1),
            "signals": top,
            "affected": [ARCHETYPES[i]["id"] for i in aff],
            "severity": "high" if lost >= 0.03 or hr[lo:hi].max() >= 2.2 else "medium",
        })
    moments.sort(key=lambda m: -m["excess_loss_pct"])
    return moments[:max_moments]


def counterfactual_gain(signals: dict, duration: float, mix: np.ndarray, params: dict,
                        signal: str, lo: int, hi: int, base_avg: float) -> float:
    """Percentage-point change in avg viewed if `signal` were brought down to a
    typical level inside [lo, hi). Model estimate only."""
    sig2 = {k: list(v) for k, v in signals.items()}
    c = params["centers"].get(signal, 0.0) if not (signal == "weak_hook" and lo >= 3) else 0.0
    for t in range(lo, min(hi, len(sig2[signal]))):
        sig2[signal][t] = min(sig2[signal][t], c * 0.5)
    alt = simulate(sig2, duration, mix, params, draws=False)
    return round((alt["avg_viewed"] - base_avg) * 100, 1)
