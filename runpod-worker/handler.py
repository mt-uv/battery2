import base64

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


def _b64_to_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))


def handler(job):
    payload = job.get("input", {})
    task = payload.get("task")

    if task == "healthcheck":
        return {"ok": True, "message": "runpod worker healthy"}

    if task == "screening":
        return {
            "ok": True,
            "result": run_screening(
                transition_metals=payload["transition_metals"],
                dopants=payload["dopants"],
                fractions=payload["fractions"],
                potential=payload.get("potential", "uma"),
            ),
        }

    if task == "screening_stream":
        events = list(
            run_screening_stream(
                transition_metals=payload["transition_metals"],
                dopants=payload["dopants"],
                fractions=payload["fractions"],
                potential=payload.get("potential", "uma"),
            )
        )
        return {"ok": True, "events": events}

    if task == "md_stream":
        events = list(
            run_md_stream(
                cif=payload["cif"],
                potential=payload.get("potential", "uma"),
            )
        )
        return {"ok": True, "events": events}

    if task == "preview_structure":
        filename = payload.get("filename", "structure.cif")
        file_bytes = _b64_to_bytes(payload["file_b64"])
        atoms = uploaded_file_to_atoms(filename, file_bytes)
        return {
            "ok": True,
            "result": {
                "filename": filename,
                "n_atoms": len(atoms),
                "cif": atoms_to_cif_string(atoms),
            },
        }

    if task == "relax":
        filename = payload.get("filename", "structure.cif")
        file_bytes = _b64_to_bytes(payload["file_b64"])
        events = list(
            run_relaxation_stream(
                filename=filename,
                file_bytes=file_bytes,
                potential=payload.get("potential", "uma"),
                fmax=float(payload.get("fmax", 0.05)),
                steps=int(payload.get("steps", 300)),
            )
        )
        return {"ok": True, "events": events}

    if task == "uploaded_md":
        filename = payload.get("filename", "structure.cif")
        file_bytes = _b64_to_bytes(payload["file_b64"])

        events = []
        for item in run_uploaded_md_stream(
            filename=filename,
            file_bytes=file_bytes,
            potential=payload.get("potential", "uma"),
            temperature_k=float(payload.get("temperature_k", 800.0)),
            timestep_fs=float(payload.get("timestep_fs", 1.0)),
            total_time_ps=float(payload.get("total_time_ps", 5.0)),
        ):
            if item.get("event") == "result" and item.get("traj_path"):
                with open(item["traj_path"], "rb") as f:
                    traj_b64 = base64.b64encode(f.read()).decode("utf-8")
                item = {k: v for k, v in item.items() if k != "traj_path"}
                item["traj_b64"] = traj_b64
            events.append(item)

        return {"ok": True, "events": events}

    if task == "synthesis_route":
        return {
            "ok": True,
            "result": generate_solid_state_synthesis_route(
                composition=payload["composition"],
                batch_mmol=float(payload.get("batch_mmol", 10.0)),
                na_excess_fraction=float(payload.get("na_excess_fraction", 0.05)),
            ),
        }

    return {"ok": False, "error": f"Unknown task '{task}'"}


runpod.serverless.start({"handler": handler})
