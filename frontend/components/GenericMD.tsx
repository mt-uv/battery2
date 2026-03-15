"use client"

import { useRef, useState } from "react"
import axios from "axios"
import CifViewer from "./CifViewer"
import AllAtomMSDChart from "./AllAtomMSDChart"

type PotentialOption = "uma" | "orb"

const API_BASE = "http://127.0.0.1:8000"

export default function GenericMD() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewCif, setPreviewCif] = useState("")
  const [previewAtomCount, setPreviewAtomCount] = useState<number | null>(null)

  const [potential, setPotential] = useState<PotentialOption>("uma")
  const [temperatureK, setTemperatureK] = useState("800")
  const [timestepFs, setTimestepFs] = useState("1.0")
  const [totalTimePs, setTotalTimePs] = useState("5.0")

  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)

  const [timePs, setTimePs] = useState<number[]>([])
  const [species, setSpecies] = useState<string[]>([])
  const [msdBySpecies, setMsdBySpecies] = useState<Record<string, number[]>>({})

  const [finalCif, setFinalCif] = useState("")
  const [resultId, setResultId] = useState<string | null>(null)

  const handleFileChange = async (f: File | null) => {
    if (!f) return

    setFile(f)
    setPreviewCif("")
    setPreviewAtomCount(null)
    setFinalCif("")
    setResultId(null)
    setTimePs([])
    setSpecies([])
    setMsdBySpecies({})

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

  const runMD = async () => {
    if (!file) {
      alert("Upload a structure file first.")
      return
    }

    setLoading(true)
    setStage("Creating MD session…")
    setTimePs([])
    setSpecies([])
    setMsdBySpecies({})
    setFinalCif("")
    setResultId(null)

    try {
      const form = new FormData()
      form.append("file", file)
      form.append("potential", potential)
      form.append("temperature_k", temperatureK)
      form.append("timestep_fs", timestepFs)
      form.append("total_time_ps", totalTimePs)

      const sessionRes = await axios.post(`${API_BASE}/md-upload-session`, form)
      const sid = sessionRes.data.session_id
      setSessionId(sid)

      const es = new EventSource(`${API_BASE}/md-upload-stream/${sid}`)

      es.addEventListener("meta", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage(`Loaded structure (${data.n_atoms} atoms), starting MD…`)
        if (data.initial_cif) setPreviewCif(data.initial_cif)

        const sp = Array.isArray(data.species) ? data.species : []
        setSpecies(sp)

        const empty: Record<string, number[]> = {}
        sp.forEach((s: string) => {
          empty[s] = []
        })
        setMsdBySpecies(empty)
      })

      es.addEventListener("progress", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage(`Step ${data.step} / ${data.steps}`)
        setTimePs((prev) => [...prev, data.time_ps])

        if (data.msd_by_species) {
          setMsdBySpecies((prev) => {
            const next: Record<string, number[]> = { ...prev }

            Object.entries(data.msd_by_species).forEach(([sp, value]) => {
              if (!next[sp]) next[sp] = []
              next[sp] = [...next[sp], Number(value)]
            })

            return next
          })
        }
      })

      es.addEventListener("result", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage("MD completed")
        setFinalCif(data.final_cif ?? "")
        setResultId(data.result_id ?? null)
      })

      es.addEventListener("cancelled", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setStage(data.message || "MD cancelled")
      })

      es.addEventListener("done", () => {
        setLoading(false)
        setSessionId(null)
        es.close()
      })

      es.addEventListener("error", (evt) => {
        try {
          const raw = (evt as MessageEvent).data
          if (raw) {
            const data = JSON.parse(raw)
            alert(data.error || "MD stream failed.")
          } else {
            alert("MD stream failed.")
          }
        } catch {
          alert("MD stream failed.")
        }
        setLoading(false)
        setStage("")
        setSessionId(null)
        es.close()
      })
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Failed to start MD")
      setLoading(false)
      setStage("")
      setSessionId(null)
    }
  }

  const stopMD = async () => {
    if (!sessionId) return

    try {
      await axios.post(`${API_BASE}/stop-upload-md/${sessionId}`)
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Failed to stop MD")
    }
  }

  const shownCif = finalCif || previewCif

  return (
    <div className="space-y-6 rounded-3xl border border-slate-700 bg-slate-900/70 p-8">
      <div>
        <h2 className="text-2xl font-semibold">Run Generic MD</h2>
        <p className="mt-2 text-sm text-slate-400">
          Upload any structure, preview it immediately, choose UMA or ORB, run MD with your chosen timestep and total time, and stream live all-atom MSD.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          <div className="text-xs text-slate-400 mb-2">Temperature (K)</div>
          <input
            type="number"
            value={temperatureK}
            onChange={(e) => setTemperatureK(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
          <div className="text-xs text-slate-400 mb-2">Timestep (fs)</div>
          <input
            type="number"
            step="0.1"
            value={timestepFs}
            onChange={(e) => setTimestepFs(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
          <div className="text-xs text-slate-400 mb-2">Total time (ps)</div>
          <input
            type="number"
            step="0.1"
            value={totalTimePs}
            onChange={(e) => setTotalTimePs(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runMD}
          disabled={!file || loading}
          className={
            !file || loading
              ? "rounded-xl bg-slate-700/40 px-4 py-3 text-sm text-slate-300 cursor-not-allowed"
              : "rounded-xl bg-indigo-600 px-4 py-3 text-sm text-white hover:bg-indigo-500"
          }
        >
          {loading ? "Running MD…" : "Run MD"}
        </button>

        <button
          type="button"
          onClick={stopMD}
          disabled={!loading || !sessionId}
          className={
            !loading || !sessionId
              ? "rounded-xl bg-slate-700/40 px-4 py-3 text-sm text-slate-300 cursor-not-allowed"
              : "rounded-xl bg-rose-600 px-4 py-3 text-sm text-white hover:bg-rose-500"
          }
        >
          Stop MD
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

      <AllAtomMSDChart timePs={timePs} msdBySpecies={msdBySpecies} live={loading} />
      
      {resultId && (
        <div className="flex flex-wrap gap-3">
          <a
            href={`${API_BASE}/download-upload-md-cif/${resultId}`}
            className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
          >
            Download final CIF
          </a>

          <a
            href={`${API_BASE}/download-upload-md-traj/${resultId}`}
            className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
          >
            Download MD trajectory
          </a>
        </div>
      )}
    </div>
  )
}