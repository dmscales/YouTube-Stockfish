export type JobState = "queued" | "processing" | "done" | "failed";

export interface Status {
  state: JobState;
  stage: string;
  progress: number;
  error: string | null;
  updated_at: string;
}

export interface Meta {
  id: string;
  title: string;
  original_name: string;
  ext: string;
  size: number;
  created_at: string;
  channel: string;
  version_label: string;
  audience: { preset: AudiencePreset; description: string };
  transcript_text: string;
}

export type AudiencePreset = "feed" | "subscribers" | "search";

export interface Feedback {
  avg_viewed_pct: number | null;
  retention: [number, number][];
  views: number | null;
  source: string;
  notes: string;
  logged_at: string;
}

export interface Moment {
  start: number;
  end: number;
  peak_hazard_ratio: number;
  excess_loss_pct: number;
  signals: string[];
  affected: string[];
  severity: "high" | "medium";
}

export interface Recommendation {
  start: number;
  end: number;
  severity: "high" | "medium" | "info";
  signal: string;
  title: string;
  why: string;
  fix: string;
  affected: string[];
  est_gain_pp: number | null;
  source: "heuristic" | "ai_reviewer";
}

export interface Reaction {
  viewer_type: string;
  segment_index: number;
  timestamp: number;
  interest_score: number;
  dropout_risk: "low" | "medium" | "high";
  reason: string;
  evidence: string;
  confidence: string;
}

export interface Prediction {
  model_version: string;
  model_trained: boolean;
  format: "short" | "long";
  audience_preset: AudiencePreset;
  audience_label: string;
  mix: Record<string, number>;
  curve: number[];
  curve_p10: number[];
  curve_p90: number[];
  baseline_curve: number[];
  archetype_curves: Record<string, number[]>;
  avg_viewed: number;
  avg_viewed_p10: number;
  avg_viewed_p90: number;
  avg_viewed_samples: number[];
  baseline_avg_viewed: number;
  watch_seconds: number;
  finish_rate: number;
  opening_risk: "High" | "Medium" | "Low";
  opening_loss: number;
  baseline_opening_loss: number;
  moments: Moment[];
  recommendations: Recommendation[];
  reactions: Reaction[];
  interest_heatmap: Record<string, number[]>;
  predicted_at: string;
}

export interface Segment {
  index: number;
  start: number;
  end: number;
  transcript: string;
  observations: {
    scene_changes: number;
    longest_static_s: number;
    speech_rate_wpm: number;
    audio_energy_db: number;
    silence_ratio: number;
    motion: number;
    new_word_ratio: number | null;
  };
  interpretation: { narrative_function: string; note?: string; source: string };
}

export interface Analysis {
  analyzed_at: string;
  video: { duration: number; width: number; height: number; has_audio: boolean; vertical: boolean };
  transcript: { source: string; words: { w: string; start: number; end: number }[] };
  hook: {
    strength: number;
    first_word_at: number | null;
    first_cut_at: number | null;
    sound_starts_at: number | null;
    hook_words: string[];
  };
  cuts: number[];
  silences: { start: number; end: number }[];
  thumbs: { t: number; file: string }[];
  segments: Segment[];
  llm: { video_summary: string; opening_promise: string } | null;
  warnings: string[];
  prediction: Prediction;
}

export interface VideoRecord {
  meta: Meta;
  status: Status;
  analysis: Analysis | null;
  feedback: Feedback | null;
}

export interface VideoSummary {
  meta: Meta;
  status: Status;
  duration: number | null;
  avg_viewed: number | null;
  avg_viewed_p10: number | null;
  avg_viewed_p90: number | null;
  opening_risk: string | null;
  model_version: string | null;
  thumb: string | null;
  has_feedback: boolean;
  actual_avg_viewed: number | null;
}

export const ARCHETYPE_LABELS: Record<string, string> = {
  impatient: "Impatient viewer",
  casual_scroller: "Casual scroller",
  new_viewer: "New viewer",
  story_focused: "Story-focused",
  audio_focused: "Audio-focused",
  niche_expert: "Niche expert",
  high_intent: "High-intent viewer",
  loyal_fan: "Loyal fan",
};

export const AUDIENCE_PRESETS: { id: AudiencePreset; label: string; hint: string }[] = [
  { id: "feed", label: "Shorts feed", hint: "Mostly strangers swiping through the feed" },
  { id: "subscribers", label: "Subscribers", hint: "People who already follow you" },
  { id: "search", label: "Search", hint: "Viewers looking for this topic" },
];
