import base64
import os
import shutil
from typing import Any, Dict, List

import runpod

from model import run_relaxation_stream, run_uploaded_md_stream


def _b64_to_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))


def _file_to_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _cleanup_path(path: str | None):
    if not path:
        return
    try:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _run_relax(payload: Dict[str, Any]) -> Dict[str, Any]:
    filename = payload["filename"]
    file_bytes = _b64_to_bytes(payload["file_b64"])
    potential = payload.get("potential", "uma")
    optimizer = payload.get("optimizer", "LBFGS")
    fmax = float(payload.get("fmax", 0.05))
    steps = int(payload.get("steps", 300))

    events: List[Dict[str, Any]] = []
    traj_path_to_cleanup = None

    for item in run_relaxation_stream(
        filename=filename,
        file_bytes=file_bytes,
        potential=potential,
        optimizer=optimizer,
        fmax=fmax,
        steps=steps,
    ):
        item = dict(item)

        if item.get("event") == "result":
            traj_path_to_cleanup = item.get("traj_path")
            if traj_path_to_cleanup and os.path.exists(traj_path_to_cleanup):
                item["traj_b64"] = _file_to_b64(traj_path_to_cleanup)
            item.pop("traj_path", None)

        events.append(item)

    _cleanup_path(traj_path_to_cleanup)

    return {
        "ok": True,
        "task": "relax",
        "events": events,
    }


def _run_uploaded_md(payload: Dict[str, Any]) -> Dict[str, Any]:
    filename = payload["filename"]
    file_bytes = _b64_to_bytes(payload["file_b64"])
    potential = payload.get("potential", "uma")
    temperature_k = float(payload.get("temperature_k", 800.0))
    timestep_fs = float(payload.get("timestep_fs", 1.0))
    total_time_ps = float(payload.get("total_time_ps", 5.0))

    events: List[Dict[str, Any]] = []
    traj_path_to_cleanup = None

    for item in run_uploaded_md_stream(
        filename=filename,
        file_bytes=file_bytes,
        potential=potential,
        temperature_k=temperature_k,
        timestep_fs=timestep_fs,
        total_time_ps=total_time_ps,
        should_stop=lambda: False,
    ):
        item = dict(item)

        if item.get("event") in {"result", "cancelled"}:
            traj_path_to_cleanup = item.get("traj_path")
            if traj_path_to_cleanup and os.path.exists(traj_path_to_cleanup):
                item["traj_b64"] = _file_to_b64(traj_path_to_cleanup)
            item.pop("traj_path", None)

        events.append(item)

    _cleanup_path(traj_path_to_cleanup)

    return {
        "ok": True,
        "task": "uploaded_md",
        "events": events,
    }


def handler(job):
    payload = job.get("input", {})
    task = payload.get("task")

    try:
        if task == "healthcheck":
            return {"ok": True, "message": "worker alive"}

        if task == "relax":
            return _run_relax(payload)

        if task == "uploaded_md":
            return _run_uploaded_md(payload)

        return {
            "ok": False,
            "error": f"Unsupported task: {task}",
        }

    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "task": task,
        }


runpod.serverless.start({"handler": handler})