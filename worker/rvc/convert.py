"""RVC v2 voice conversion on CPU for the render worker (Stage B of the Own Voice provider).

Reads a JSON list of jobs ({"model", "index", "input", "output", "pitch"}) and converts each input WAV (the acted
Gemini take) into the character's own voice with the user's trained model. RVC keeps the input's timing frame for
frame, so pacing, pauses and acting stay; only the timbre changes. Models are loaded once per character.

Usage: python convert.py jobs.json
"""

import json
import os
import sys
import time

from rvc_python.infer import RVCInference


def main(path: str) -> int:
    jobs = json.load(open(path, encoding="utf-8"))
    if not jobs:
        return 0
    rvc = RVCInference(device="cpu:0")
    loaded = None
    for i, job in enumerate(jobs, 1):
        if job["model"] != loaded:
            index = job.get("index") or ""
            rvc.load_model(job["model"], version="v2", index_path=index)
            # rmvpe: robust pitch on speech; index_rate only with an index; protect keeps consonants and breaths clear
            rvc.set_params(
                f0method=os.environ.get("RVC_F0_METHOD", "rmvpe"),
                f0up_key=int(job.get("pitch", 0)),
                index_rate=float(os.environ.get("RVC_INDEX_RATE", "0.6")) if index else 0.0,
                filter_radius=3,
                rms_mix_rate=0.25,
                protect=0.33,
            )
            loaded = job["model"]
        started = time.time()
        rvc.infer_file(job["input"], job["output"])
        print(f"[rvc] {i}/{len(jobs)} {os.path.basename(job['output'])} in {time.time() - started:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
