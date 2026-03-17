from typing import Dict, List
import base64
import json
import os
import tempfile
from uuid import uuid4

import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, PlainTextResponse
from pydantic import BaseModel

app = FastAPI(title="Na Layered Cathode Screening API")

cors_origins_env = os.getenv("BACKEND_CORS_ORIGINS", "")
allow_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
if not allow_origins:
    allow_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")

MD_SESSIONS: Dict[str, Dict] = {}
SCREENING_SESSIONS: Dict[str, Dict] = {}
RELAX_UPLOAD_SESSIONS: Dict[str, Dict] = {}
UPLOAD_MD_SESSIONS: Dict[str, Dict] = {}
RELAX_RESULTS: Dict[str, Dict] = {}
UPLOAD_MD_RESULTS: Dict[str, Dict] = {}


class ScreeningRequest(BaseModel):
    transition_metals: List[str]
    dopants: List[str]
    fractions: Dict[str, float]
    potential: str = "uma"


class MDRequest(BaseModel):
    cif: str
    potential: str = "uma"


class SynthesisRouteRequest(BaseModel):
    composition: Dict[str, float]
    batch_mmol: float = 10.0
    na_excess_fraction: float = 0.05


def bytes_to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def b64_to_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))


def call_runpod(payload: dict):
    if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
        raise RuntimeError("RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID is not set")

    url = f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/runsync"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {RUNPOD_API_KEY}",
            "Content-Type": "application/json",
        },
        json={"input": payload},
        timeout=1800,
    )
    resp.raise_for_status()
    return resp.json()


def parse_runpod_output(payload: dict):
    output = payload.get("output")
    if isinstance(output, dict):
        return output
    if isinstance(payload, dict) and "ok" in payload:
        return payload
    raise RuntimeError("Unexpected RunPod response format")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/runpod-health")
def runpod_health():
    return parse_runpod_output(call_runpod({"task": "healthcheck"}))


@app.post("/preview-structure")
async def preview_structure(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        runpod_result = parse_runpod_output(
            call_runpod(
                {
                    "task": "preview_structure",
                    "filename": file.filename or "structure.cif",
                    "file_b64": bytes_to_b64(content),
                }
            )
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse structure: {e}")

    if not runpod_result.get("ok", False):
        raise HTTPException(status_code=400, detail=runpod_result.get("error", "Preview failed"))

    return runpod_result["result"]


@app.post("/run")
def run(req: ScreeningRequest):
    result = parse_runpod_output(
        call_runpod(
            {
                "task": "screening",
                "transition_metals": req.transition_metals,
                "dopants": req.dopants,
                "fractions": req.fractions,
                "potential": req.potential,
            }
        )
    )
    if not result.get("ok", False):
        raise HTTPException(status_code=400, detail=result.get("error", "Screening failed"))
    return result["result"]


@app.post("/run-session")
def create_screening_session(req: ScreeningRequest):
    session_id = uuid4().hex
    SCREENING_SESSIONS[session_id] = {
        "transition_metals": req.transition_metals,
        "dopants": req.dopants,
        "fractions": req.fractions,
        "potential": req.potential,
    }
    return {"session_id": session_id}


@app.get("/run-stream/{session_id}")
def run_screening_stream_route(session_id: str):
    payload = SCREENING_SESSIONS.pop(session_id, None)
    if payload is None:
        raise HTTPException(status_code=404, detail="Screening session not found or already used")

    def event_stream():
        try:
            yield "event: status\n"
            yield "data: " + json.dumps({"message": "Screening stream started"}) + "\n\n"

            result = parse_runpod_output(
                call_runpod(
                    {
                        "task": "screening_stream",
                        **payload,
                    }
                )
            )
            if not result.get("ok", False):
                raise RuntimeError(result.get("error", "RunPod screening stream failed"))

            for item in result.get("events", []):
                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield "data: " + json.dumps({"message": "Screening stream completed"}) + "\n\n"
        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/run-md-session")
def create_md_session(req: MDRequest):
    if not req.cif.strip():
        raise HTTPException(status_code=400, detail="CIF input is empty")

    session_id = uuid4().hex
    MD_SESSIONS[session_id] = {
        "cif": req.cif,
        "potential": req.potential,
        "cancelled": False,
        "consumed": False,
    }
    return {"session_id": session_id}


@app.post("/stop-md/{session_id}")
def stop_md(session_id: str):
    payload = MD_SESSIONS.get(session_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="MD session not found")
    payload["cancelled"] = True
    return {"status": "stopping", "session_id": session_id}


@app.get("/run-md-stream/{session_id}")
def run_md_stream_route(session_id: str):
    payload = MD_SESSIONS.get(session_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="MD session not found")
    if payload.get("consumed"):
        raise HTTPException(status_code=404, detail="MD session already used")

    payload["consumed"] = True

    def event_stream():
        try:
            yield "event: status\n"
            yield "data: " + json.dumps({"message": "MD stream started"}) + "\n\n"

            result = parse_runpod_output(
                call_runpod(
                    {
                        "task": "md_stream",
                        "cif": payload["cif"],
                        "potential": payload["potential"],
                    }
                )
            )
            if not result.get("ok", False):
                raise RuntimeError(result.get("error", "RunPod MD stream failed"))

            for item in result.get("events", []):
                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield "data: " + json.dumps({"message": "MD stream completed"}) + "\n\n"
        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"
        finally:
            MD_SESSIONS.pop(session_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/generate-synthesis-route")
def generate_synthesis_route(req: SynthesisRouteRequest):
    result = parse_runpod_output(
        call_runpod(
            {
                "task": "synthesis_route",
                "composition": req.composition,
                "batch_mmol": req.batch_mmol,
                "na_excess_fraction": req.na_excess_fraction,
            }
        )
    )
    if not result.get("ok", False):
        raise HTTPException(status_code=400, detail=result.get("error", "Synthesis generation failed"))
    return result["result"]


@app.post("/relax-upload-session")
async def create_relax_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    session_id = uuid4().hex
    RELAX_UPLOAD_SESSIONS[session_id] = {
        "filename": file.filename or "structure.cif",
        "content": content,
        "potential": potential,
    }
    return {"session_id": session_id}


@app.get("/relax-upload-stream/{session_id}")
def relax_upload_stream(session_id: str):
    payload = RELAX_UPLOAD_SESSIONS.pop(session_id, None)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relax upload session not found or already used")

    def event_stream():
        try:
            result_id = uuid4().hex
            result = parse_runpod_output(
                call_runpod(
                    {
                        "task": "relax",
                        "filename": payload["filename"],
                        "file_b64": bytes_to_b64(payload["content"]),
                        "potential": payload["potential"],
                    }
                )
            )
            if not result.get("ok", False):
                raise RuntimeError(result.get("error", "RunPod relax failed"))

            for item in result.get("events", []):
                if item.get("event") == "result":
                    RELAX_RESULTS[result_id] = {"relaxed_cif": item["relaxed_cif"]}
                    item["result_id"] = result_id
                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield 'data: {"message":"Relaxation completed"}\n\n'
        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/download-relaxed-cif/{result_id}")
def download_relaxed_cif(result_id: str):
    payload = RELAX_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relaxation result not found")

    return PlainTextResponse(
        payload["relaxed_cif"],
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="relaxed_structure.cif"'},
    )


@app.post("/md-upload-session")
async def create_md_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
    temperature_k: float = Form(800.0),
    timestep_fs: float = Form(1.0),
    total_time_ps: float = Form(5.0),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    session_id = uuid4().hex
    UPLOAD_MD_SESSIONS[session_id] = {
        "filename": file.filename or "structure.cif",
        "content": content,
        "potential": potential,
        "temperature_k": temperature_k,
        "timestep_fs": timestep_fs,
        "total_time_ps": total_time_ps,
        "cancelled": False,
        "consumed": False,
    }
    return {"session_id": session_id}


@app.post("/stop-upload-md/{session_id}")
def stop_upload_md(session_id: str):
    payload = UPLOAD_MD_SESSIONS.get(session_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Upload MD session not found")
    payload["cancelled"] = True
    return {"status": "stopping", "session_id": session_id}


@app.get("/md-upload-stream/{session_id}")
def md_upload_stream(session_id: str):
    payload = UPLOAD_MD_SESSIONS.get(session_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Upload MD session not found")
    if payload.get("consumed"):
        raise HTTPException(status_code=404, detail="Upload MD session already used")

    payload["consumed"] = True

    def event_stream():
        try:
            result_id = uuid4().hex
            result = parse_runpod_output(
                call_runpod(
                    {
                        "task": "uploaded_md",
                        "filename": payload["filename"],
                        "file_b64": bytes_to_b64(payload["content"]),
                        "potential": payload["potential"],
                        "temperature_k": payload["temperature_k"],
                        "timestep_fs": payload["timestep_fs"],
                        "total_time_ps": payload["total_time_ps"],
                    }
                )
            )
            if not result.get("ok", False):
                raise RuntimeError(result.get("error", "RunPod uploaded MD failed"))

            for item in result.get("events", []):
                if item.get("event") in {"result", "cancelled"}:
                    traj_b64 = item.pop("traj_b64", None)
                    traj_path = None
                    if traj_b64:
                        with tempfile.NamedTemporaryFile(delete=False, suffix=".traj") as tmp:
                            tmp.write(b64_to_bytes(traj_b64))
                            traj_path = tmp.name

                    if item.get("event") == "result":
                        UPLOAD_MD_RESULTS[result_id] = {
                            "final_cif": item["final_cif"],
                            "traj_path": traj_path,
                        }
                        item["result_id"] = result_id

                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield 'data: {"message":"Upload MD completed"}\n\n'
        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"
        finally:
            UPLOAD_MD_SESSIONS.pop(session_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/download-upload-md-traj/{result_id}")
def download_upload_md_traj(result_id: str):
    payload = UPLOAD_MD_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Upload MD result not found")

    return FileResponse(
        payload["traj_path"],
        filename="uploaded_md.traj",
        media_type="application/octet-stream",
    )


@app.get("/download-upload-md-cif/{result_id}")
def download_upload_md_cif(result_id: str):
    payload = UPLOAD_MD_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Upload MD result not found")

    return PlainTextResponse(
        payload["final_cif"],
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="uploaded_md_final.cif"'},
    )
