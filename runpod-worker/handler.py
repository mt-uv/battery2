import base64
import os

import runpod

from model import (
    atoms_to_cif_string,
    generate_solid_state_synthesis_route,
    run_md_stream,
    run_relaxation_stream,
    run_screening,
    run_screening_stream,
    run_uploaded_md_stream,
    uploaded_file_to_atoms,
)

# This handler is a generator: every yielded dict is published on the job's
# /stream endpoint as soon as it is produced, so the backend can forward
# progress live. Single-result tasks yield one {"event": "result", "result": ...}
# item; failures yield one {"event": "error", "error": ...} item.


def _b64_to_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))


def _single(value):
    return {"event": "result", "result": value}


def _inline_traj(item: dict) -> dict:
    """Replace a local trajectory path with its base64 contents."""
    traj_path = item.get("traj_path")
    if not traj_path:
        return item

    item = {k: v for k, v in item.items() if k != "traj_path"}
    try:
        with open(traj_path, "rb") as f:
            item["traj_b64"] = base64.b64encode(f.read()).decode("utf-8")
    finally:
        try:
            os.remove(traj_path)
        except OSError:
            pass
    return item


def _dispatch(payload: dict):
    task = payload.get("task")

    if task == "healthcheck":
        yield _single({"ok": True, "message": "runpod worker healthy"})
        return

    if task == "screening":
        yield _single(
            run_screening(
                transition_metals=payload["transition_metals"],
                dopants=payload["dopants"],
                fractions=payload["fractions"],
                potential=payload.get("potential", "uma"),
            )
        )
        return

    if task == "screening_stream":
        yield from run_screening_stream(
            transition_metals=payload["transition_metals"],
            dopants=payload["dopants"],
            fractions=payload["fractions"],
            potential=payload.get("potential", "uma"),
        )
        return

    if task == "md_stream":
        yield from run_md_stream(
            cif=payload["cif"],
            potential=payload.get("potential", "uma"),
        )
        return

    if task == "preview_structure":
        filename = payload.get("filename", "structure.cif")
        atoms = uploaded_file_to_atoms(filename, _b64_to_bytes(payload["file_b64"]))
        yield _single(
            {
                "filename": filename,
                "n_atoms": len(atoms),
                "cif": atoms_to_cif_string(atoms),
            }
        )
        return

    if task == "relax":
        for item in run_relaxation_stream(
            filename=payload.get("filename", "structure.cif"),
            file_bytes=_b64_to_bytes(payload["file_b64"]),
            potential=payload.get("potential", "uma"),
            optimizer=payload.get("optimizer", "LBFGS"),
            fmax=float(payload.get("fmax", 0.05)),
            steps=int(payload.get("steps", 300)),
        ):
            yield _inline_traj(item)
        return

    if task == "uploaded_md":
        for item in run_uploaded_md_stream(
            filename=payload.get("filename", "structure.cif"),
            file_bytes=_b64_to_bytes(payload["file_b64"]),
            potential=payload.get("potential", "uma"),
            temperature_k=float(payload.get("temperature_k", 800.0)),
            timestep_fs=float(payload.get("timestep_fs", 1.0)),
            total_time_ps=float(payload.get("total_time_ps", 5.0)),
        ):
            yield _inline_traj(item)
        return

    if task == "synthesis_route":
        yield _single(
            generate_solid_state_synthesis_route(
                composition=payload["composition"],
                batch_mmol=float(payload.get("batch_mmol", 10.0)),
                na_excess_fraction=float(payload.get("na_excess_fraction", 0.05)),
            )
        )
        return

    raise ValueError(f"Unknown task '{task}'")


def handler(job):
    try:
        yield from _dispatch(job.get("input", {}) or {})
    except Exception as e:
        yield {"event": "error", "error": str(e)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
