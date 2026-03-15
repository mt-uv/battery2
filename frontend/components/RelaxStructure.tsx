"use client"

import { useRef, useState } from "react"
import axios from "axios"
import CifViewer from "./CifViewer"

type PotentialOption = "uma" | "orb"
type OptimizerOption = "LBFGS" | "BFGS" | "FIRE"

const API_BASE = "http://127.0.0.1:8000"

export default function RelaxStructure() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewCif, setPreviewCif] = useState("")
  const [previewAtomCount, setPreviewAtomCount] = useState<number | null>(null)

  const [potential, setPotential] = useState<PotentialOption>("uma")
  const [optimizer, setOptimizer] = useState<OptimizerOption>("LBFGS")

  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState("")
  const [logLines, setLogLines] = useState<string[]>([])

  const [initialEnergy, setInitialEnergy] = useState<number | null>(null)
  const [finalEnergy, setFinalEnergy] = useState<number | null>(null)
  const [relaxedCif, setRelaxedCif] = useState("")
  const [resultId, setResultId] = useState<string | null>(null)

  const handleFileChange = async (f: File | null) => {
    if (!f) return

    setFile(f)
    setPreviewCif("")
    setPreviewAtomCount(null)
    setRelaxedCif("")
    setInitialEnergy(null)
    setFinalEnergy(null)
    setResultId(null)
    setLogLines([])

    const form = new FormData()
    form.append("file", f)

    try {
      const res = await axios.post(`${API_BASE}/preview-structure`, form)
      setPreviewCif(res.data.cif)
      setPreviewAtomCount(res.data.n_atoms)
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed to preview structure")
    }
  }

  const runRelaxation = async () => {
    if (!file) {
      alert("Upload a structure file first.")
      return
    }

    setLoading(true)
    setStage("Creating relaxation session…")
    setLogLines([])
    setRelaxedCif("")
    setInitialEnergy(null)
    setFinalEnergy(null)
    setResultId(null)

    try {
      const form = new FormData()
      form.append("file", file)
      form.append("potential", potential)
      form.append("optimizer", optimizer)

      const sessionRes = await axios.post(`${API_BASE}/relax-upload-session`, form)
      const sessionId = sessionRes.data.session_id

      const es = new EventSource(`${API_BASE}/relax-upload-stream/${sessionId}`)

      es.addEventListener("meta", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage(`Loaded structure (${data.n_atoms} atoms)`)
        if (data.initial_cif) setPreviewCif(data.initial_cif)
        if (typeof data.initial_energy === "number") setInitialEnergy(data.initial_energy)
      })

      es.addEventListener("progress", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage(`Relaxing with ${data.step}/${data.steps}`)
        if (data.log_line) {
          setLogLines((prev) => [...prev.slice(-199), data.log_line])
        }
      })

      es.addEventListener("result", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage("Relaxation completed")
        setInitialEnergy(typeof data.initial_energy === "number" ? data.initial_energy : null)
        setFinalEnergy(typeof data.final_energy === "number" ? data.final_energy : null)
        setRelaxedCif(data.relaxed_cif ?? "")
        setResultId(data.result_id ?? null)
      })

      es.addEventListener("done", () => {
        setLoading(false)
        es.close()
      })

      es.addEventListener("error", (evt) => {
        try {
          const raw = (evt as MessageEvent).data
          if (raw) {
            const data = JSON.parse(raw)
            alert(data.error || "Relaxation stream failed.")
          } else {
            alert("Relaxation stream failed.")
          }
        } catch {
          alert("Relaxation stream failed.")
        }
        setLoading(false)
        setStage("")
        es.close()
      })
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Failed to start relaxation")
      setLoading(false)
      setStage("")
    }
  }

  const shownCif = relaxedCif || previewCif

  return (
    <div className="space-y-6 rounded-3xl border border-slate-700 bg-slate-900/70 p-8">
      <div>
        <h2 className="text-2xl font-semibold">Relax Structure</h2>
        <p className="mt-2 text-sm text-slate-400">
          Upload a structure, preview it immediately, choose UMA or ORB and an optimizer, then stream the relaxation output live.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
        >
          {file ? `Selected: ${file.name}` : "Upload structure file"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".cif,.vasp,.poscar,.xyz,.traj"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
          <div className="text-xs text-slate-400 mb-2">ML potential</div>
          <select
            value={potential}
            onChange={(e) => setPotential(e.target.value as PotentialOption)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
          >
            <option value="uma">UMA</option>
            <option value="orb">ORB</option>
          </select>
        </label>

        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
          <div className="text-xs text-slate-400 mb-2">Optimizer</div>
          <select
            value={optimizer}
            onChange={(e) => setOptimizer(e.target.value as OptimizerOption)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
          >
            <option value="LBFGS">LBFGS</option>
            <option value="BFGS">BFGS</option>
            <option value="FIRE">FIRE</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runRelaxation}
          disabled={!file || loading}
          className={
            !file || loading
              ? "rounded-xl bg-slate-700/40 px-4 py-3 text-sm text-slate-300 cursor-not-allowed"
              : "rounded-xl bg-indigo-600 px-4 py-3 text-sm text-white hover:bg-indigo-500"
          }
        >
          {loading ? "Running relaxation…" : "Run relaxation"}
        </button>

        {previewAtomCount != null && (
          <div className="text-sm text-slate-400">{previewAtomCount} atoms loaded</div>
        )}
      </div>

      {(loading || stage) && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-200">
          {stage || "Working…"}
        </div>
      )}

      {shownCif && <CifViewer cif={shownCif} />}

      {(initialEnergy != null || finalEnergy != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
            <div className="text-xs text-slate-400">Initial energy</div>
            <div className="mt-1 text-white font-medium">
              {initialEnergy != null ? `${initialEnergy.toFixed(6)} eV` : "—"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
            <div className="text-xs text-slate-400">Final energy</div>
            <div className="mt-1 text-white font-medium">
              {finalEnergy != null ? `${finalEnergy.toFixed(6)} eV` : "—"}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
        <div className="text-sm font-medium text-slate-200 mb-3">Relaxation output</div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">
          {logLines.length ? logLines.join("\n") : "No output yet."}
        </pre>
      </div>

      {resultId && (
        <div className="flex flex-wrap gap-3">
          <a
            href={`${API_BASE}/download-relaxed-cif/${resultId}`}
            className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
          >
            Download relaxed CIF
          </a>

          <a
            href={`${API_BASE}/download-relax-traj/${resultId}`}
            className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
          >
            Download relaxation trajectory
          </a>
        </div>
      )}
    </div>
  )
}