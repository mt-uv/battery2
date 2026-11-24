from typing import Callable, Dict, Iterator, List, Optional
import base64
import json
import os
import tempfile
import threading
import time
from uuid import uuid4

import anyio
import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, PlainTextResponse
from starlette.concurrency import iterate_in_threadpool
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
RUNPOD_API_BASE = os.getenv("RUNPOD_API_BASE", "https://api.runpod.ai/v2").rstrip("/")
RUNPOD_POLL_INTERVAL_S = float(os.getenv("RUNPOD_POLL_INTERVAL_S", "1.0"))
RUNPOD_JOB_TIMEOUT_S = float(os.getenv("RUNPOD_JOB_TIMEOUT_S", "7200"))

RUNPOD_FAILED_STATUSES = {"FAILED", "CANCELLED", "TIMED_OUT"}

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

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


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def sse_response(make_stream: Callable[[Callable[[], bool]], Iterator[str]]) -> StreamingResponse:
    """Stream SSE chunks from a blocking generator.

    make_stream receives a disconnected() callable that turns true once the
    browser has gone away, so the generator can cancel its RunPod job.
    """
    disconnected = threading.Event()
    chunks = make_stream(disconnected.is_set)

    def close_chunks():
        try:
            chunks.close()  # runs stream_runpod_job's cleanup, which cancels the job
        except ValueError:
            pass  # still running in another thread; disconnected() stops it instead

    async def body():
        try:
            async for chunk in iterate_in_threadpool(chunks):
                yield chunk
        finally:
            disconnected.set()
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(close_chunks)

    return StreamingResponse(body(), media_type="text/event-stream", headers=SSE_HEADERS)


def save_traj_b64(traj_b64: Optional[str]) -> Optional[str]:
    if not traj_b64:
        return None
    with tempfile.NamedTemporaryFile(delete=False, suffix=".traj") as tmp:
        tmp.write(b64_to_bytes(traj_b64))
        return tmp.name


# ----------------------------
# RunPod serverless client
# ----------------------------

def _runpod_url(path: str) -> str:
    if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
        raise RuntimeError("RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID is not set")
    return f"{RUNPOD_API_BASE}/{RUNPOD_ENDPOINT_ID}/{path}"


def _runpod_headers() -> dict:
    return {
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
        "Content-Type": "application/json",
    }


def submit_runpod_job(payload: dict) -> str:
    resp = requests.post(
        _runpod_url("run"),
        headers=_runpod_headers(),
        json={"input": payload},
        timeout=60,
    )
    resp.raise_for_status()
    job_id = resp.json().get("id")
    if not job_id:
        raise RuntimeError(f"RunPod did not return a job id: {resp.text[:300]}")
    return job_id


def cancel_runpod_job(job_id: str) -> None:
    try:
        requests.post(_runpod_url(f"cancel/{job_id}"), headers=_runpod_headers(), timeout=30)
    except Exception:
        pass


def _runpod_job_error(job_id: str, status: str) -> str:
    try:
        resp = requests.get(_runpod_url(f"status/{job_id}"), headers=_runpod_headers(), timeout=30)
        error = resp.json().get("error")
        if error:
            return f"RunPod job {status}: {error}"
    except Exception:
        pass
    return f"RunPod job {status}"


def stream_runpod_job(
    payload: dict,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> Iterator[dict]:
    """Submit a job and yield each item the worker's generator handler emits.

    Yields {"event": "cancelled", ...} and cancels the RunPod job if
    should_cancel() becomes true. If the caller stops iterating early
    (e.g. the browser disconnects), the RunPod job is cancelled too.
    """
    job_id = submit_runpod_job(payload)
    deadline = time.monotonic() + RUNPOD_JOB_TIMEOUT_S
    finished = False

    try:
        while True:
            if should_cancel is not None and should_cancel():
                cancel_runpod_job(job_id)
                finished = True
                yield {"event": "cancelled", "message": "Stopped by user"}
                return

            resp = requests.get(_runpod_url(f"stream/{job_id}"), headers=_runpod_headers(), timeout=60)
            resp.raise_for_status()
            data = resp.json()

            for chunk in data.get("stream") or []:
                output = chunk.get("output") if isinstance(chunk, dict) else None
                if isinstance(output, dict):
                    if output.get("event") == "error":
                        finished = True
                        raise RuntimeError(output.get("error", "RunPod worker error"))
                    yield output

            status = data.get("status")
            if status == "COMPLETED":
                finished = True
                return
            if status in RUNPOD_FAILED_STATUSES:
                finished = True
                raise RuntimeError(_runpod_job_error(job_id, status))
            if time.monotonic() > deadline:
                raise RuntimeError(f"RunPod job timed out after {RUNPOD_JOB_TIMEOUT_S:.0f} s")

            time.sleep(RUNPOD_POLL_INTERVAL_S)
    finally:
        if not finished:
            cancel_runpod_job(job_id)


def run_runpod_task(payload: dict):
    """Run a single-result task and return its result."""
    for item in stream_runpod_job(payload):
        if item.get("event") == "result":
            return item.get("result")
    raise RuntimeError("RunPod job finished without a result")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/runpod-health")
def runpod_health():
    try:
        return run_runpod_task({"task": "healthcheck"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/preview-structure")
async def preview_structure(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        return run_runpod_task(
            {
                "task": "preview_structure",
                "filename": file.filename or "structure.cif",
                "file_b64": bytes_to_b64(content),
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse structure: {e}")


@app.post("/run")
def run(req: ScreeningRequest):
    try:
        return run_runpod_task(
            {
                "task": "screening",
                "transition_metals": req.transition_metals,
                "dopants": req.dopants,
                "fractions": req.fractions,
                "potential": req.potential,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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

    def event_stream(disconnected):
        try:
            yield sse("status", {"message": "Screening job submitted"})

            for item in stream_runpod_job(
                {"task": "screening_stream", **payload},
                should_cancel=disconnected,
            ):
                yield sse(item.get("event", "progress"), item)

            yield sse("done", {"message": "Screening stream completed"})
        except Exception as e:
            yield sse("error", {"error": str(e)})

    return sse_response(event_stream)


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

    def event_stream(disconnected):
        try:
            yield sse("status", {"message": "MD job submitted"})

            for item in stream_runpod_job(
                {
                    "task": "md_stream",
                    "cif": payload["cif"],
                    "potential": payload["potential"],
                },
                should_cancel=lambda: disconnected() or payload.get("cancelled", False),
            ):
                yield sse(item.get("event", "progress"), item)

            yield sse("done", {"message": "MD stream completed"})
        except Exception as e:
            yield sse("error", {"error": str(e)})
        finally:
            MD_SESSIONS.pop(session_id, None)

    return sse_response(event_stream)


@app.post("/generate-synthesis-route")
def generate_synthesis_route(req: SynthesisRouteRequest):
    try:
        return run_runpod_task(
            {
                "task": "synthesis_route",
                "composition": req.composition,
                "batch_mmol": req.batch_mmol,
                "na_excess_fraction": req.na_excess_fraction,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/relax-upload-session")
async def create_relax_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
    optimizer: str = Form("LBFGS"),
    fmax: float = Form(0.05),
    steps: int = Form(300),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    session_id = uuid4().hex
    RELAX_UPLOAD_SESSIONS[session_id] = {
        "filename": file.filename or "structure.cif",
        "content": content,
        "potential": potential,
        "optimizer": optimizer,
        "fmax": fmax,
        "steps": steps,
    }
    return {"session_id": session_id}


@app.get("/relax-upload-stream/{session_id}")
def relax_upload_stream(session_id: str):
    payload = RELAX_UPLOAD_SESSIONS.pop(session_id, None)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relax upload session not found or already used")

    def event_stream(disconnected):
        try:
            result_id = uuid4().hex

            for item in stream_runpod_job(
                {
                    "task": "relax",
                    "filename": payload["filename"],
                    "file_b64": bytes_to_b64(payload["content"]),
                    "potential": payload["potential"],
                    "optimizer": payload["optimizer"],
                    "fmax": payload["fmax"],
                    "steps": payload["steps"],
                },
                should_cancel=disconnected,
            ):
                if item.get("event") == "result":
                    RELAX_RESULTS[result_id] = {
                        "relaxed_cif": item["relaxed_cif"],
                        "traj_path": save_traj_b64(item.pop("traj_b64", None)),
                    }
                    item["result_id"] = result_id
                yield sse(item.get("event", "progress"), item)

            yield sse("done", {"message": "Relaxation completed"})
        except Exception as e:
            yield sse("error", {"error": str(e)})

    return sse_response(event_stream)


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


@app.get("/download-relax-traj/{result_id}")
def download_relax_traj(result_id: str):
    payload = RELAX_RESULTS.get(result_id)
    if payload is None or not payload.get("traj_path"):
        raise HTTPException(status_code=404, detail="Relaxation trajectory not found")

    return FileResponse(
        payload["traj_path"],
        filename="relaxation.traj",
        media_type="application/octet-stream",
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

    def event_stream(disconnected):
        try:
            result_id = uuid4().hex

            for item in stream_runpod_job(
                {
                    "task": "uploaded_md",
                    "filename": payload["filename"],
                    "file_b64": bytes_to_b64(payload["content"]),
                    "potential": payload["potential"],
                    "temperature_k": payload["temperature_k"],
                    "timestep_fs": payload["timestep_fs"],
                    "total_time_ps": payload["total_time_ps"],
                },
                should_cancel=lambda: disconnected() or payload.get("cancelled", False),
            ):
                if item.get("event") == "result":
                    UPLOAD_MD_RESULTS[result_id] = {
                        "final_cif": item["final_cif"],
                        "traj_path": save_traj_b64(item.pop("traj_b64", None)),
                    }
                    item["result_id"] = result_id
                yield sse(item.get("event", "progress"), item)

            yield sse("done", {"message": "Upload MD completed"})
        except Exception as e:
            yield sse("error", {"error": str(e)})
        finally:
            UPLOAD_MD_SESSIONS.pop(session_id, None)

    return sse_response(event_stream)


@app.get("/download-upload-md-traj/{result_id}")
def download_upload_md_traj(result_id: str):
    payload = UPLOAD_MD_RESULTS.get(result_id)
    if payload is None or not payload.get("traj_path"):
        raise HTTPException(status_code=404, detail="Upload MD trajectory not found")

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
