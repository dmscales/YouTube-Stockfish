"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUDIENCE_PRESETS, type AudiencePreset } from "@/lib/types";
import { bytes } from "@/lib/format";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [channel, setChannel] = useState("");
  const [preset, setPreset] = useState<AudiencePreset>("feed");
  const [description, setDescription] = useState("");
  const [transcript, setTranscript] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a video file first");
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("title", title);
    fd.set("version_label", versionLabel);
    fd.set("channel", channel);
    fd.set("preset", preset);
    fd.set("audience_description", description);
    fd.set("transcript", transcript);
    // XHR so we can show upload progress
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(ev.loaded / ev.total);
    xhr.onload = () => {
      const res = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 300) {
        setProgress(null);
        setError(res.error ?? "Upload failed");
      } else router.push(`/analysis/${res.id}`);
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed. Check your connection.");
    };
    setProgress(0);
    xhr.send(fd);
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Analyze a draft</h1>

      <label
        className="card flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-8 text-center hover:border-accent"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <input type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <div className="font-medium">{file.name}</div>
            <div className="text-sm text-muted">{bytes(file.size)} · click to change</div>
          </>
        ) : (
          <>
            <div className="font-medium">Drop a video here or click to choose</div>
            <div className="text-sm text-muted">MP4, MOV or WebM. Built for 15-60 second Shorts; works up to 15 minutes.</div>
          </>
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" />
        </div>
        <div>
          <label className="label" htmlFor="ver">Version label</label>
          <input id="ver" className="input" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. Draft 03" />
        </div>
      </div>

      <fieldset>
        <legend className="label">Who will see this first?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {AUDIENCE_PRESETS.map((p) => (
            <label key={p.id} className={`card cursor-pointer p-3 text-sm ${preset === p.id ? "border-accent ring-1 ring-accent" : ""}`}>
              <input type="radio" name="preset" className="sr-only" checked={preset === p.id} onChange={() => setPreset(p.id)} />
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted">{p.hint}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="desc">Niche and intended audience (optional)</label>
        <input id="desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Minecraft speedrun fans, 16-24" />
      </div>

      <div>
        <label className="label" htmlFor="channel">Channel (optional)</label>
        <input id="channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Used to group results when the model trains" />
      </div>

      <div>
        <label className="label" htmlFor="script">Script or transcript (optional)</label>
        <textarea
          id="script"
          className="input min-h-28"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste the narration if speech-to-text isn't installed. Used to detect repetition, slow pacing and missing new information."
        />
      </div>

      {error && <div className="text-sm text-critical">{error}</div>}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={!file || progress !== null}>
          {progress === null ? "Upload and analyze" : `Uploading ${Math.round(progress * 100)}%`}
        </button>
        <span className="text-xs text-muted">Files stay on this machine (data/ folder).</span>
      </div>
    </form>
  );
}
