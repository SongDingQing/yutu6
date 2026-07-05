#!/usr/bin/env python3
"""Backend bridge for the local LocateAnything-3B Node wrapper.

Reads one JSON request from stdin and writes one JSON response to stdout.
This script intentionally does not install dependencies or download weights.
"""
import base64
import io
import json
import os
import sys


def load_image(payload):
    from PIL import Image

    if payload.get("image_path"):
        return Image.open(payload["image_path"]).convert("RGB")
    if payload.get("image_base64"):
        raw = base64.b64decode(payload["image_base64"])
        return Image.open(io.BytesIO(raw)).convert("RGB")
    raise ValueError("image_path or image_base64 is required")


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    model = (
        payload.get("model_dir")
        or os.environ.get("LOCATE_ANYTHING_MODEL_DIR")
        or payload.get("model")
        or os.environ.get("LOCATE_ANYTHING_MODEL")
        or "nvidia/LocateAnything-3B"
    )

    from locateanything_worker import LocateAnythingWorker

    img = load_image(payload)
    worker = LocateAnythingWorker(model)
    task = str(payload.get("task") or "ground_gui")
    query = str(payload.get("query") or "")
    output_type = str(payload.get("output_type") or "point")

    if task in ("gui", "ground_gui"):
        result = worker.ground_gui(img, query, output_type=output_type)
    elif task in ("ground", "ground_multi"):
        result = worker.ground_multi(img, query)
    elif task in ("point", "pointing"):
        result = worker.point(img, query)
    elif task in ("detect_text", "ocr"):
        result = worker.detect_text(img)
    elif task == "detect":
        labels = [s.strip() for s in query.replace("</c>", ",").split(",") if s.strip()]
        result = worker.detect(img, labels)
    else:
        raise ValueError(f"unsupported task: {task}")

    if isinstance(result, dict):
        answer = result.get("answer") or result.get("raw_answer")
        out = dict(result)
        out["answer"] = answer
    else:
        out = {"answer": str(result)}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
