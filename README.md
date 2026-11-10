# Draft Check (YouTube Stockfish MVP)

Upload an unfinished Short, see where a simulated audience is likely to swipe away, get timestamped edits to fix it, compare two edits, and log real results after publishing so the model learns.

This is the Shorts-first MVP from the plan: phases 1-4 work end to end, and phases 5-6 (collect real results, train, measure against a baseline) are built in as a simple local loop.

## What it does

1. **Video intelligence** (`worker/features.py`). FFmpeg + numpy measure, per second: scene cuts, motion, time since the last visual change, loudness, silence, speech rate, how many spoken words are new, repeated phrases, and how strong the first 3 seconds are. Observations are stored separately from interpretations.
2. **Simulated audience** (`worker/audience.py`). 8 viewer archetypes (impatient, casual scroller, new viewer, story-focused, audio-focused, niche expert, high-intent, loyal fan), each reacting differently to the same signals. You choose the audience mix: Shorts feed, subscribers or search.
3. **Prediction engine** (`worker/predict.py`). A discrete-time survival model, `R(t) = P(T >= t)`. Each archetype's dropout hazard is a duration-aware baseline scaled by the video's risk signals. It outputs a median retention curve, a 10th-90th percentile range (200 Monte Carlo draws), opening risk, finish rate, and the moments that lose more viewers than a typical video of the same length.
4. **Edit recommendations** (`worker/recommend.py`). Each risk moment becomes a specific fix ("Cut 4.0s from this shot, or add a punch-in around 00:08"), ranked by a counterfactual: rerun the model with that problem fixed and see how much average viewed % moves.
5. **Optional AI reviewer** (`worker/llm.py`). If `ANTHROPIC_API_KEY` is set, Claude looks at keyframes, the transcript and the measured segments, gives per-archetype reactions and extra edit ideas. Its opinion goes into the model as one more signal (`llm_disinterest`), so training can learn how much it is actually worth.
6. **Compare edits**. Two versions get scored on the same simulated audience draws, so you get "B beats A in 87% of draws" instead of two numbers that can't be compared.
7. **Feedback loop** (`worker/train.py`). Log real retention (from your YouTube Studio or your own test viewers) on the analysis page. With 3+ logged videos, the Model accuracy page fits the model and reports holdout error against a duration-only baseline, holding out whole channels when you have more than one. Target: beat the baseline by 20% before calling it a prediction engine.

Until it's trained on real data, the numbers are a **risk ranking, not a forecast**. The UI says this everywhere.

## Run it

Needs Node 20+, Python 3.10+, and `ffmpeg`/`ffprobe` on your PATH.

```bash
npm install
```

```bash
pip install -r requirements.txt
```

`faster-whisper` (word-level transcripts) and `anthropic` (AI reviewer) are optional. Without whisper you can paste the script on the upload page.

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://localhost:3000 and click **Analyze a draft**.

No footage handy? Generate two synthetic test drafts (a slow, silent opening vs a tight edit):

```bash
npm run sample
```

## Project layout

```
app/                    Next.js pages + API routes
  page.tsx              dashboard (your drafts)
  upload/               upload form
  analysis/[id]/        results: stats, retention chart, fixes, audience heatmap, timeline, real results
  compare/              side-by-side edit comparison
  model/                training + holdout accuracy
  api/                  videos, feedback, media streaming, thumbnails, model training
components/             RetentionChart, Heatmap, RiskBadge
lib/store.ts            local-disk storage (data/videos/<id>/...)
lib/jobs.ts             in-process job queue that runs the Python worker
worker/
  analyze.py            pipeline entry point (full analysis or re-predict)
  features.py           measurements from the video file
  audience.py           viewer archetypes + reactions
  predict.py            survival model, uncertainty, risk moments, counterfactuals
  recommend.py          timestamped edit suggestions
  llm.py                optional Claude reviewer (structured output)
  train.py              fit + cross-validate on logged results
  model_defaults.json   hand-set starting coefficients
scripts/make_samples.sh synthetic test videos
```

Data lives in `data/` (gitignored): one folder per video with the source file, `meta.json`, `status.json`, `analysis.json`, `feedback.json` and thumbnails. Trained parameters go to `data/model_params.json` and the accuracy report to `data/model_report.json`.

## Running the worker by hand

```bash
python3 worker/analyze.py --dir data/videos/<id>
```

```bash
python3 worker/train.py --dry-run
```

## Not in this MVP (on purpose)

- Accounts, billing, multi-user. Storage and the queue are local so the whole thing runs on one laptop. `lib/store.ts` and `lib/jobs.ts` are the two files to swap for Supabase + R2 and Redis + Python workers.
- View-count predictions, a YouTube algorithm clone, automatic re-editing.
- Pulling retention from the YouTube Analytics API. Check YouTube's developer policies before training on API data: they restrict pooling across content owners and derived metrics. Your own test-viewer sessions are the cleanest dataset to build.

## Next steps

1. Run 20-50 of your own past Shorts through it and log their real retention. Train. See if it beats the baseline.
2. If it doesn't, look at which signals the model down-weights and fix the measurements first.
3. Build the test-viewer player (record where real people stop on drafts) to grow a dataset you own.
