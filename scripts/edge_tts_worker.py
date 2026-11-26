#!/usr/bin/env python3
"""Edge TTS for the autonomous scheduler worker (free, no API key, voice id-ID-ArdiNeural).

Usage: python scripts/edge_tts_worker.py jobs.json

jobs.json is a list of {"text", "voice", "rate", "pitch", "out"}: the text is already the TTS text (phonetic fixes
applied by the app), rate / pitch come from the character and the pose (src/lib/voice/edge.ts). Each job is saved as
an MP3 at "out"; video/edge-stage.mts trims, levels and uploads it. A failed line is retried 3 times, then the script
exits non-zero with the reason, so the slot fails with it instead of rendering a silent line.
"""
import asyncio
import json
import os
import sys

import edge_tts


async def synth(job: dict) -> None:
    last = None
    for attempt in range(1, 4):
        try:
            com = edge_tts.Communicate(
                job["text"],
                job.get("voice", "id-ID-ArdiNeural"),
                rate=job["rate"],
                pitch=job["pitch"],
                proxy=os.environ.get("HTTPS_PROXY") or None,
            )
            await com.save(job["out"])
            if os.path.getsize(job["out"]) > 0:
                return
            last = RuntimeError("empty audio")
        except Exception as e:  # network hiccups, service throttling
            last = e
        await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"Edge TTS failed for {os.path.basename(job['out'])}: {last}")


async def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        jobs = json.load(f)
    for i, job in enumerate(jobs, 1):
        await synth(job)
        print(f"edge-tts {i}/{len(jobs)}: {os.path.basename(job['out'])} rate={job['rate']} pitch={job['pitch']}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: edge_tts_worker.py jobs.json")
    try:
        asyncio.run(main(sys.argv[1]))
    except Exception as e:
        sys.exit(str(e))
