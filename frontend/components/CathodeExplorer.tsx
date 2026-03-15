"use client"

import { useMemo, useState, useEffect, useId, useRef } from "react"
import axios from "axios"
import LiveMSDChart from "./LiveMSDChart"
import { API_BASE } from "@/lib/api"

type PotentialOption = "uma" | "orb"

type ConfigEnergy = {
  name: string
  index: number
  energy: number
}

type SelectedConfiguration = {
  name: string
  index: number
  energy: number
}

type MdMeta = {
  potential?: string
  temperature_k?: number
  timestep_fs?: number
  steps?: number
  sample_interval?: number
  total_time_ps?: number
  n_atoms?: number
  n_na_atoms?: number
  n_non_na_atoms?: number
  na_vacancy_fraction?: number
  na_removed_for_md?: number
  cif_md_start?: string
  avg_temperature_k?: number
  final_temperature_k?: number
}

type ApiResult = {
  potential?: string
  voltage: number
  sodiated_energy: number
  desodiated_energy: number
  tm_sites: number
  dopant_sites: number
  chosen_tm: string
  chosen_dopant: string
  na_removed: number
  mu_na: number
  composition?: Record<string, number>
  site_counts?: Record<string, number>
  n_configurations?: number
  configuration_energies?: ConfigEnergy[]
  selected_configuration?: SelectedConfiguration
  cif_doped?: string
  cif_sodiated_relaxed?: string
  cif_desodiated_relaxed?: string
}

type ScreeningStreamEvent =
  | {
      event?: string
      message?: string
      progress?: number
      stage?: string
      config_index?: number
      config_total?: number
      energy?: number
      configuration_energies?: ConfigEnergy[]
      selected_configuration?: SelectedConfiguration
      site_counts?: Record<string, number>
    }
  | (ApiResult & {
      event?: string
      message?: string
      progress?: number
    })

type SynthesisPrecursor = {
  element: string
  fraction: number
  precursor: string
  metal_per_precursor: number
  moles_precursor: number
  mmol_precursor: number
  molar_mass_g_mol: number
  mass_g: number
  note: string
}

type SynthesisRouteResult = {
  formula: string
  batch_mmol: number
  na_excess_fraction: number
  precursors: SynthesisPrecursor[]
  procedure: string
}


const TM_OPTIONS = ["Mn", "Ni", "Co", "Fe", "Cr", "V", "Ti"]
const DOPANT_OPTIONS = ["Mg", "Al", "Zn", "Cu", "Zr", "Y", "Nb"]
const POTENTIAL_OPTIONS: { label: string; value: PotentialOption }[] = [
  { label: "UMA", value: "uma" },
  { label: "ORB", value: "orb" },
]

declare global {
  interface Window {
    $3Dmol: any
  }
}

function classNames(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

function TogglePill({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={classNames(
        "px-3 py-2 rounded-xl border text-sm transition select-none",
        checked
          ? "bg-indigo-600/20 border-indigo-500 text-white"
          : "bg-slate-900/40 border-slate-700 text-slate-200 hover:border-slate-500"
      )}
      aria-pressed={checked}
    >
      {label}
    </button>
  )
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "px-3 py-2 rounded-xl text-sm border transition",
        active
          ? "bg-slate-900/70 border-slate-500 text-white"
          : "bg-slate-900/30 border-slate-700 text-slate-300 hover:border-slate-500"
      )}
    >
      {label}
    </button>
  )
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function formatNumber(x: number | null | undefined, digits = 4) {
  if (x == null || !Number.isFinite(x)) return "—"
  return x.toFixed(digits)
}

async function load3DMolLocal(): Promise<void> {
  if (typeof window === "undefined") return
  if (window.$3Dmol) return

  const existing = document.querySelector<HTMLScriptElement>('script[data-3dmol="1"]')
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (window.$3Dmol) {
        resolve()
        return
      }
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Failed to load 3Dmol")), {
        once: true,
      })
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "/3Dmol-min.js"
    s.async = true
    s.dataset["3dmol"] = "1"
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("Failed to load /3Dmol-min.js"))
    document.head.appendChild(s)
  })

  if (!window.$3Dmol) {
    throw new Error("3Dmol loaded but window.$3Dmol is undefined")
  }
}

function CifViewer({ cif }: { cif: string }) {
  const rid = useId()
  const containerId = useMemo(() => `viewer-${rid.replace(/:/g, "")}`, [rid])

  const [err, setErr] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle")

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      setErr("")

      if (!cif?.trim()) {
        setStatus("idle")
        return
      }

      setStatus("loading")
      await load3DMolLocal()
      if (cancelled) return

      const el = document.getElementById(containerId)
      if (!el) throw new Error("Viewer container not found")

      el.innerHTML = ""
      el.style.position = "relative"
      el.style.width = "100%"
      el.style.height = "380px"
      el.style.overflow = "hidden"

      const viewer = window.$3Dmol.createViewer(containerId, {
        backgroundColor: "#070a12",
      })

      viewer.addModel(cif, "cif")
      viewer.setStyle({}, { stick: {}, sphere: { scale: 0.28 } })
      viewer.zoomTo()
      viewer.render()

      setStatus("ready")
    }

    render().catch((e) => {
      console.error(e)
      setErr(String(e?.message || "Failed to render CIF"))
      setStatus("idle")
    })

    return () => {
      cancelled = true
    }
  }, [cif, containerId])

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-200">Structure preview</div>
        <div className="text-xs text-slate-400">
          {status === "ready"
            ? "Interactive 3D"
            : status === "loading"
              ? "Loading viewer..."
              : "CIF → 3D"}
        </div>
      </div>

      {err ? (
        <div className="p-4 text-sm text-rose-300">{err}</div>
      ) : (
        <div className="p-4">
          <div
            id={containerId}
            className="relative h-[380px] w-full overflow-hidden rounded-xl border border-slate-700 bg-[#070a12]"
          />
        </div>
      )}
    </div>
  )
}


export default function CathodeExplorer() {
  const [selectedPotential, setSelectedPotential] = useState<PotentialOption>("uma")
  const [selectedTMs, setSelectedTMs] = useState<string[]>(["Ni"])
  const [selectedDopants, setSelectedDopants] = useState<string[]>(["Zr"])
  const [fractions, setFractions] = useState<Record<string, string>>({
    Ni: "1.0",
    Zr: "0.0",
  })

  const [result, setResult] = useState<ApiResult | null>(null)
  const [streamConfigEnergies, setStreamConfigEnergies] = useState<ConfigEnergy[]>([])
  const [streamSelectedConfig, setStreamSelectedConfig] = useState<SelectedConfiguration | null>(null)
  const [streamProgress, setStreamProgress] = useState<number>(0)
  const screeningEventSourceRef = useRef<EventSource | null>(null)

  const [mdMeta, setMdMeta] = useState<MdMeta | null>(null)
  const [mdTimePs, setMdTimePs] = useState<number[]>([])
  const [mdMsdNa, setMdMsdNa] = useState<number[]>([])
  const [mdMsdNonNa, setMdMsdNonNa] = useState<number[]>([])
  const [mdCurrentStep, setMdCurrentStep] = useState(0)
  const [mdCurrentTemp, setMdCurrentTemp] = useState<number | null>(null)
  const [mdLive, setMdLive] = useState(false)
  const [mdSessionId, setMdSessionId] = useState<string | null>(null)
  const mdEventSourceRef = useRef<EventSource | null>(null)

  const [synthesisRoute, setSynthesisRoute] = useState<SynthesisRouteResult | null>(null)
  const [synthesisLoading, setSynthesisLoading] = useState(false)
  const [batchMmol, setBatchMmol] = useState("10.0")
  const [naExcessFraction, setNaExcessFraction] = useState("0.05")

  const [loading, setLoading] = useState(false)
  const [mdLoading, setMdLoading] = useState(false)
  const [mdStopping, setMdStopping] = useState(false)
  const [stage, setStage] = useState("")
  const [mdStage, setMdStage] = useState("")
  const [activeTab, setActiveTab] = useState<"doped" | "sod" | "desod" | "md">("doped")

  const canRun = selectedTMs.length > 0 && selectedDopants.length > 0

  const selectedElements = useMemo(
    () => [...selectedTMs, ...selectedDopants],
    [selectedTMs, selectedDopants]
  )

  useEffect(() => {
    setFractions((prev) => {
      const next: Record<string, string> = {}
      for (const el of selectedElements) {
        next[el] = prev[el] ?? ""
      }
      return next
    })
  }, [selectedElements])

  useEffect(() => {
    return () => {
      screeningEventSourceRef.current?.close()
      mdEventSourceRef.current?.close()
    }
  }, [])

  const tmSubtitle = useMemo(
    () => (selectedTMs.length ? `${selectedTMs.length} selected` : "Select ≥ 1"),
    [selectedTMs]
  )

  const dopSubtitle = useMemo(
    () => (selectedDopants.length ? `${selectedDopants.length} selected` : "Select ≥ 1"),
    [selectedDopants]
  )

  const selectedPotentialLabel = useMemo(
    () => POTENTIAL_OPTIONS.find((p) => p.value === selectedPotential)?.label ?? "UMA",
    [selectedPotential]
  )

  const resultPotentialLabel = useMemo(() => {
    const value = (result?.potential ?? selectedPotential).toLowerCase()
    return POTENTIAL_OPTIONS.find((p) => p.value === value)?.label ?? value.toUpperCase()
  }, [result?.potential, selectedPotential])

  const mdPotentialLabel = useMemo(() => {
    const value = (mdMeta?.potential ?? selectedPotential).toLowerCase()
    return POTENTIAL_OPTIONS.find((p) => p.value === value)?.label ?? value.toUpperCase()
  }, [mdMeta?.potential, selectedPotential])

  const fractionSum = useMemo(() => {
    return selectedElements.reduce((sum, el) => {
      const v = Number(fractions[el])
      return sum + (Number.isFinite(v) ? v : 0)
    }, 0)
  }, [selectedElements, fractions])

  const fractionsValid = useMemo(() => {
    if (selectedElements.length === 0) return false

    for (const el of selectedElements) {
      const raw = fractions[el]
      if (raw === "" || raw === undefined) return false
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0 || v > 1) return false
    }

    return Math.abs(fractionSum - 1) < 1e-6
  }, [selectedElements, fractions, fractionSum])

  const compositionPreview = useMemo(() => {
    const parts = selectedElements
      .map((el) => {
        const raw = fractions[el]
        if (raw === "" || raw === undefined) return null
        const v = Number(raw)
        if (!Number.isFinite(v) || v <= 0) return null
        return `${el}${v}`
      })
      .filter(Boolean)

    return `Na1 ${parts.join(" ")} O2`
  }, [selectedElements, fractions])

  const toggle = (arr: string[], v: string, setArr: (a: string[]) => void) => {
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  }

  const resetMDState = () => {
    mdEventSourceRef.current?.close()
    mdEventSourceRef.current = null
    setMdSessionId(null)
    setMdMeta(null)
    setMdTimePs([])
    setMdMsdNa([])
    setMdMsdNonNa([])
    setMdCurrentStep(0)
    setMdCurrentTemp(null)
    setMdLive(false)
    setMdStage("")
    setMdLoading(false)
    setMdStopping(false)
  }

  const currentCompositionForSynthesis = useMemo(() => {
    if (result?.composition && Object.keys(result.composition).length > 0) {
      return result.composition
    }

    const out: Record<string, number> = {}
    for (const el of selectedElements) {
      const v = Number(fractions[el])
      if (Number.isFinite(v) && v > 0) out[el] = v
    }
    return out
  }, [result?.composition, selectedElements, fractions])

  const canGenerateSynthesis = useMemo(() => {
    const batch = Number(batchMmol)
    const excess = Number(naExcessFraction)
    return (
      Object.keys(currentCompositionForSynthesis).length > 0 &&
      Number.isFinite(batch) &&
      batch > 0 &&
      Number.isFinite(excess) &&
      excess >= 0 &&
      excess <= 0.5
    )
  }, [currentCompositionForSynthesis, batchMmol, naExcessFraction])

  const runScreening = async () => {
    if (!canRun) return

    if (!fractionsValid) {
      alert("TM + dopant fractions must all be valid numbers between 0 and 1, and their sum must equal 1.")
      return
    }

    const payloadFractions: Record<string, number> = {}
    for (const el of selectedElements) {
      payloadFractions[el] = Number(fractions[el])
    }

    screeningEventSourceRef.current?.close()
    setLoading(true)
    setResult(null)
    setSynthesisRoute(null)
    setStreamConfigEnergies([])
    setStreamSelectedConfig(null)
    setStreamProgress(0)
    resetMDState()
    setActiveTab("doped")
    setStage("Creating screening session…")

    try {
      const sessionRes = await axios.post<{ session_id: string }>(
        `${API_BASE}/run-session`,
        {
          transition_metals: selectedTMs,
          dopants: selectedDopants,
          fractions: payloadFractions,
          potential: selectedPotential,
        },
        { timeout: 0 }
      )

      const sessionId = sessionRes.data.session_id
      const es = new EventSource(`${API_BASE}/run-stream/${sessionId}`)
      screeningEventSourceRef.current = es

      es.addEventListener("status", (evt) => {
        const data: ScreeningStreamEvent = JSON.parse((evt as MessageEvent).data)
        if (data.message) setStage(data.message)
        if (typeof data.progress === "number") setStreamProgress(data.progress)
        if (data.selected_configuration) setStreamSelectedConfig(data.selected_configuration)
      })

      es.addEventListener("progress", (evt) => {
        const data: ScreeningStreamEvent = JSON.parse((evt as MessageEvent).data)
        if (data.message) setStage(data.message)
        if (typeof data.progress === "number") setStreamProgress(data.progress)
      })

      es.addEventListener("config_done", (evt) => {
        const data: ScreeningStreamEvent = JSON.parse((evt as MessageEvent).data)
        if (data.configuration_energies) {
          setStreamConfigEnergies(data.configuration_energies)
        }
        if (typeof data.progress === "number") setStreamProgress(data.progress)
        if (data.message) setStage(data.message)
      })

      es.addEventListener("result", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data) as ApiResult
        setResult(data)
        setStreamConfigEnergies(data.configuration_energies ?? [])
        setStreamSelectedConfig(data.selected_configuration ?? null)
        setStreamProgress(1)
        setStage("Screening completed")
      })

      es.addEventListener("done", () => {
        setLoading(false)
        es.close()
        screeningEventSourceRef.current = null
      })

      es.addEventListener("error", (evt) => {
        try {
          const raw = (evt as MessageEvent).data
          if (raw) {
            const data = JSON.parse(raw)
            alert(data.error || "Screening stream failed.")
          } else {
            alert("Screening stream failed.")
          }
        } catch {
          alert("Screening stream failed.")
        }
        setLoading(false)
        setStage("")
        es.close()
        screeningEventSourceRef.current = null
      })
    } catch (e: any) {
      console.error(e)
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Backend not running, or request failed."
      alert(String(msg))
      setLoading(false)
      setStage("")
    }
  }

  const runMD = async () => {
    if (!result?.cif_sodiated_relaxed?.trim()) {
      alert("No selected sodiated structure available for MD.")
      return
    }

    setMdLoading(true)
    setMdStopping(false)
    resetMDState()
    setMdLoading(true)
    setActiveTab("md")
    setMdStage("Creating MD session…")

    try {
      const sessionRes = await axios.post<{ session_id: string }>(
        `${API_BASE}/run-md-session`,
        {
          cif: result.cif_sodiated_relaxed,
          potential: result.potential ?? selectedPotential,
        },
        { timeout: 0 }
      )

      const sessionId = sessionRes.data.session_id
      setMdSessionId(sessionId)
      setMdLive(true)
      setMdStage("Streaming MD progress…")

      const es = new EventSource(`${API_BASE}/run-md-stream/${sessionId}`)
      mdEventSourceRef.current = es

      es.addEventListener("status", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setMdStage(data.message || "Running MD…")
        if (data.cif_md_start) {
          setMdMeta((prev) => ({
            ...(prev ?? {}),
            cif_md_start: data.cif_md_start,
            potential: result.potential ?? selectedPotential,
            na_removed_for_md: data.na_removed_for_md ?? prev?.na_removed_for_md,
            na_vacancy_fraction: data.na_vacancy_fraction ?? prev?.na_vacancy_fraction,
          }))
        }
      })

      es.addEventListener("meta", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setMdMeta(data)
        if (data.cif_md_start) setActiveTab("md")
      })

      es.addEventListener("progress", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setMdCurrentStep(data.step)
        setMdCurrentTemp(data.temperature_k)
        setMdTimePs((prev) => [...prev, data.time_ps])
        setMdMsdNa((prev) => [...prev, data.msd_na])
        setMdMsdNonNa((prev) => [...prev, data.msd_non_na])
      })

      es.addEventListener("result", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setMdMeta((prev) => ({
          ...(prev ?? {}),
          ...data,
        }))
      })

      es.addEventListener("cancelled", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data)
        setMdStage(data.message || "MD cancelled")
        setMdMeta((prev) => ({
          ...(prev ?? {}),
          ...data,
        }))
        setMdLive(false)
        setMdLoading(false)
        setMdStopping(false)
      })

      es.addEventListener("done", () => {
        setMdStage((prev) => prev || "MD completed")
        setMdLive(false)
        setMdLoading(false)
        setMdStopping(false)
        setMdSessionId(null)
        es.close()
        mdEventSourceRef.current = null
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
        setMdLive(false)
        setMdLoading(false)
        setMdStopping(false)
        setMdStage("")
        setMdSessionId(null)
        es.close()
        mdEventSourceRef.current = null
      })
    } catch (e: any) {
      console.error(e)
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "MD request failed."
      alert(String(msg))
      setMdLive(false)
      setMdLoading(false)
      setMdStopping(false)
      setMdStage("")
      setMdSessionId(null)
    }
  }

  const stopMD = async () => {
    if (!mdSessionId || !mdLive) return

    setMdStopping(true)
    setMdStage("Stopping MD…")

    try {
      await axios.post(
        `${API_BASE}/stop-md/${mdSessionId}`,
        {},
        { timeout: 0 }
      )
    } catch (e: any) {
      console.error(e)
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to stop MD."
      alert(String(msg))
      setMdStopping(false)
    }
  }

  const generateSynthesisRoute = async () => {
    const batch = Number(batchMmol)
    const excess = Number(naExcessFraction)

    if (!canGenerateSynthesis) {
      alert("Enter a valid composition, batch size > 0, and Na excess fraction between 0 and 0.5.")
      return
    }

    try {
      setSynthesisLoading(true)
      setSynthesisRoute(null)

      const res = await axios.post<SynthesisRouteResult>(
        `${API_BASE}/generate-synthesis-route`,
        {
          composition: currentCompositionForSynthesis,
          batch_mmol: batch,
          na_excess_fraction: excess,
        },
        { timeout: 0 }
      )

      setSynthesisRoute(res.data)
    } catch (e: any) {
      console.error(e)
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to generate synthesis route."
      alert(String(msg))
    } finally {
      setSynthesisLoading(false)
    }
  }

  const cifForTab = useMemo(() => {
    if (activeTab === "md") return mdMeta?.cif_md_start ?? ""
    if (!result) return ""
    if (activeTab === "doped") return result.cif_doped ?? ""
    if (activeTab === "sod") return result.cif_sodiated_relaxed ?? ""
    return result.cif_desodiated_relaxed ?? ""
  }, [result, mdMeta, activeTab])

  const downloadName = useMemo(() => {
    if (activeTab === "md") return "md_start_structure.cif"
    if (!result) return "structure.cif"
    if (activeTab === "doped") return "doped.cif"
    if (activeTab === "sod") return "sodiated_relaxed.cif"
    return "desodiated_relaxed.cif"
  }, [result, activeTab])

  const shownConfigEnergies = result?.configuration_energies ?? streamConfigEnergies
  const shownSelectedConfiguration = result?.selected_configuration ?? streamSelectedConfig

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-800 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-6xl bg-slate-900/70 backdrop-blur-xl border border-slate-700 rounded-3xl shadow-2xl p-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Na-ion Cathode Material Explorer
          </h1>
          <p className="text-slate-400">
            Stream configuration screening, run MD with stop control, and generate a solid-state synthesis route from the selected composition.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">ML potential</h2>
            <span className="text-xs text-slate-400">Choose calculator</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {POTENTIAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedPotential(opt.value)}
                className={classNames(
                  "px-3 py-2 rounded-xl border text-sm transition select-none",
                  selectedPotential === opt.value
                    ? "bg-indigo-600/20 border-indigo-500 text-white"
                    : "bg-slate-900/40 border-slate-700 text-slate-200 hover:border-slate-500"
                )}
                aria-pressed={selectedPotential === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Transition metals</h2>
              <span className="text-xs text-slate-400">{tmSubtitle}</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">Allowed on the TM layer.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {TM_OPTIONS.map((el) => (
                <TogglePill
                  key={el}
                  label={el}
                  checked={selectedTMs.includes(el)}
                  onToggle={() => toggle(selectedTMs, el, setSelectedTMs)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Dopants</h2>
              <span className="text-xs text-slate-400">{dopSubtitle}</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">At least one dopant is required.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DOPANT_OPTIONS.map((el) => (
                <TogglePill
                  key={el}
                  label={el}
                  checked={selectedDopants.includes(el)}
                  onToggle={() => toggle(selectedDopants, el, setSelectedDopants)}
                />
              ))}
            </div>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Composition</h2>
            <span className="text-xs text-slate-400">Sum must equal 1.000</span>
          </div>

          <p className="mt-2 text-sm text-slate-400">
            Fill fractions for the selected transition metals and dopants below.
            Na is fixed at 1 and O is fixed at 2.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selectedElements.map((el) => (
              <div
                key={el}
                className="rounded-xl bg-slate-900/40 border border-slate-700 p-4"
              >
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-200">{el}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={fractions[el] ?? ""}
                    onChange={(e) =>
                      setFractions((prev) => ({
                        ...prev,
                        [el]: e.target.value,
                      }))
                    }
                    className="w-28 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </label>
              </div>
            ))}

            <div className="rounded-xl bg-slate-900/20 border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-400">Na</span>
                <span className="text-sm text-slate-300">1 (fixed)</span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-900/20 border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-400">O</span>
                <span className="text-sm text-slate-300">2 (fixed)</span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Current TM + dopant sum</span>
                <span
                  className={classNames(
                    "font-medium",
                    fractionsValid ? "text-emerald-300" : "text-amber-300"
                  )}
                >
                  {fractionSum.toFixed(3)}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <span className="text-slate-400">Formula preview</span>
                <span className="text-right text-slate-200 font-medium">{compositionPreview}</span>
              </div>

              {!fractionsValid && (
                <div className="text-xs text-amber-300">
                  Enter valid fractions between 0 and 1, and make sure the total equals exactly 1.
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-8 flex flex-col md:flex-row gap-4 items-stretch md:items-center">
          <button
            onClick={runScreening}
            disabled={!canRun || loading || !fractionsValid}
            className={classNames(
              "flex-1 p-3 rounded-xl font-medium transition",
              !canRun || loading || !fractionsValid
                ? "bg-slate-700/40 text-slate-300 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
            )}
          >
            {loading ? `Running ${selectedPotentialLabel}…` : "Run Screening"}
          </button>

          <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
            <div className="flex gap-2">
              <span className="text-slate-400">Potential:</span>
              <span>{selectedPotentialLabel}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-slate-400">TM:</span>
              <span>{selectedTMs.join(", ") || "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-slate-400">Dopants:</span>
              <span>{selectedDopants.join(", ") || "—"}</span>
            </div>
          </div>
        </div>

        {loading && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              <div className="text-sm text-slate-200">{stage || `Running ${selectedPotentialLabel}…`}</div>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${Math.max(2, Math.min(100, streamProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {(shownConfigEnergies.length > 0 || result) && (
          <div className="mt-10 space-y-6">
            {shownConfigEnergies.length > 0 && (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold text-indigo-400">
                    Generated configurations
                  </h2>
                  <p className="text-sm text-slate-300">
                    {(result?.n_configurations ?? shownConfigEnergies.length)} configurations were generated and their sodiated total energies were calculated.
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {shownConfigEnergies.map((cfg) => {
                    const selected = cfg.index === shownSelectedConfiguration?.index
                    return (
                      <div
                        key={cfg.index}
                        className={classNames(
                          "rounded-xl border p-4",
                          selected
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-slate-700 bg-slate-950/30"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-white">{cfg.name}</div>
                          <div className="text-sm text-slate-300">
                            {cfg.energy.toFixed(6)} eV
                          </div>
                        </div>
                        {selected && (
                          <div className="mt-2 text-xs text-emerald-300">
                            Lowest-energy configuration selected
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {result && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-6 bg-slate-800 rounded-2xl border border-slate-700">
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-indigo-400">Voltage result</h2>
                      <p className="text-slate-300 text-sm">
                        Potential: <span className="text-white font-medium">{resultPotentialLabel}</span>{" "}
                        · TM: <span className="text-white font-medium">{result.chosen_tm}</span> · Dopant:{" "}
                        <span className="text-white font-medium">{result.chosen_dopant}</span>
                      </p>
                    </div>
                    <div className="text-4xl font-bold">
                      {Number(result.voltage).toFixed(3)}{" "}
                      <span className="text-base font-medium text-slate-300">V</span>
                    </div>
                  </div>

                  {result.composition && (
                    <div className="mt-4 rounded-xl bg-slate-900/40 border border-slate-700 p-4 text-sm text-slate-300">
                      <div className="text-slate-400 mb-1">Composition</div>
                      <div className="text-white font-medium">
                        Na1{" "}
                        {Object.entries(result.composition)
                          .filter(([, v]) => Number(v) > 0)
                          .map(([k, v]) => `${k}${v}`)
                          .join(" ")}{" "}
                        O2
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-300">
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">Sodiated energy</div>
                      <div className="mt-1 font-medium text-white">
                        {result.sodiated_energy.toFixed(3)} eV
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">Desodiated energy</div>
                      <div className="mt-1 font-medium text-white">
                        {result.desodiated_energy.toFixed(3)} eV
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">TM sites</div>
                      <div className="mt-1 font-medium text-white">{result.tm_sites}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">Dopant sites</div>
                      <div className="mt-1 font-medium text-white">{result.dopant_sites}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">Na removed for voltage</div>
                      <div className="mt-1 font-medium text-white">{result.na_removed}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                      <div className="text-slate-400">μNa ({resultPotentialLabel})</div>
                      <div className="mt-1 font-medium text-white">{result.mu_na.toFixed(3)} eV</div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-200">Optional live MD diffusion check</div>
                        <div className="text-xs text-slate-400 mt-1">
                          MD runs only when requested, streams Na / non-Na MSD live, and can be stopped manually.
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          type="button"
                          onClick={runMD}
                          disabled={mdLoading || !result.cif_sodiated_relaxed?.trim()}
                          className={classNames(
                            "rounded-xl px-4 py-3 text-sm font-medium transition",
                            mdLoading || !result.cif_sodiated_relaxed?.trim()
                              ? "bg-slate-700/40 text-slate-300 cursor-not-allowed"
                              : "bg-emerald-600 hover:bg-emerald-500 text-white"
                          )}
                        >
                          {mdLoading ? `Streaming ${resultPotentialLabel} MD…` : "Run MD to Check Na Diffusion"}
                        </button>

                        <button
                          type="button"
                          onClick={stopMD}
                          disabled={!mdLive || !mdSessionId || mdStopping}
                          className={classNames(
                            "rounded-xl px-4 py-3 text-sm font-medium transition",
                            !mdLive || !mdSessionId || mdStopping
                              ? "bg-slate-700/40 text-slate-300 cursor-not-allowed"
                              : "bg-rose-600 hover:bg-rose-500 text-white"
                          )}
                        >
                          {mdStopping ? "Stopping MD…" : "Stop MD"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-200">Generate synthesis route</div>
                        <div className="text-xs text-slate-400 mt-1">
                          Uses the current screened composition and returns precursor masses plus a suggested solid-state route.
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
                          <div className="text-xs text-slate-400 mb-2">Batch size (mmol)</div>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={batchMmol}
                            onChange={(e) => setBatchMmol(e.target.value)}
                            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                          />
                        </label>

                        <label className="rounded-xl border border-slate-700 bg-slate-950/30 p-4">
                          <div className="text-xs text-slate-400 mb-2">Na excess fraction</div>
                          <input
                            type="number"
                            min="0"
                            max="0.5"
                            step="0.01"
                            value={naExcessFraction}
                            onChange={(e) => setNaExcessFraction(e.target.value)}
                            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={generateSynthesisRoute}
                        disabled={synthesisLoading || !canGenerateSynthesis}
                        className={classNames(
                          "rounded-xl px-4 py-3 text-sm font-medium transition",
                          synthesisLoading || !canGenerateSynthesis
                            ? "bg-slate-700/40 text-slate-300 cursor-not-allowed"
                            : "bg-amber-600 hover:bg-amber-500 text-white"
                        )}
                      >
                        {synthesisLoading ? "Generating synthesis route…" : "Generate Synthesis Route"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <TabButton
                      active={activeTab === "doped"}
                      label="Doped"
                      onClick={() => setActiveTab("doped")}
                    />
                    <TabButton
                      active={activeTab === "sod"}
                      label="Sodiated relaxed"
                      onClick={() => setActiveTab("sod")}
                    />
                    <TabButton
                      active={activeTab === "desod"}
                      label="Desodiated relaxed"
                      onClick={() => setActiveTab("desod")}
                    />
                    {mdMeta?.cif_md_start && (
                      <TabButton
                        active={activeTab === "md"}
                        label="MD start"
                        onClick={() => setActiveTab("md")}
                      />
                    )}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => {
                        if (!cifForTab?.trim()) return
                        downloadText(downloadName, cifForTab)
                      }}
                      className={classNames(
                        "px-3 py-2 rounded-xl text-sm border transition",
                        cifForTab?.trim()
                          ? "bg-slate-900/50 border-slate-700 text-slate-200 hover:border-slate-500"
                          : "bg-slate-900/20 border-slate-800 text-slate-500 cursor-not-allowed"
                      )}
                      disabled={!cifForTab?.trim()}
                    >
                      Download CIF
                    </button>
                  </div>

                  <CifViewer cif={cifForTab || ""} />
                </div>
              </div>
            )}
          </div>
        )}

        {(mdLoading || mdStage) && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
            <div className="text-sm text-slate-200">
              {mdStage || `Streaming ${selectedPotentialLabel} MD…`}
              {mdCurrentStep > 0 && mdMeta?.steps && (
                <div className="text-xs text-slate-400 mt-1">
                  Step {mdCurrentStep} / {mdMeta.steps}
                  {mdCurrentTemp != null ? ` · T = ${mdCurrentTemp.toFixed(1)} K` : ""}
                </div>
              )}
            </div>
          </div>
        )}

        {(mdMeta || mdTimePs.length > 0) && (
          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-indigo-400">Live MD diffusion check</h2>
              <p className="text-sm text-slate-300">
                Na and non-Na MSD are streaming live from the backend.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm text-slate-300">
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Potential</div>
                <div className="mt-1 font-medium text-white">{mdPotentialLabel}</div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Na vacancy fraction</div>
                <div className="mt-1 font-medium text-white">
                  {mdMeta?.na_vacancy_fraction != null
                    ? `${(100 * mdMeta.na_vacancy_fraction).toFixed(0)}%`
                    : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Na removed for MD</div>
                <div className="mt-1 font-medium text-white">
                  {mdMeta?.na_removed_for_md ?? "—"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">MD temperature</div>
                <div className="mt-1 font-medium text-white">
                  {mdMeta?.temperature_k != null ? `${mdMeta.temperature_k} K` : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Current step</div>
                <div className="mt-1 font-medium text-white">
                  {mdCurrentStep}
                  {mdMeta?.steps ? ` / ${mdMeta.steps}` : ""}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Current T</div>
                <div className="mt-1 font-medium text-white">
                  {mdCurrentTemp != null ? `${mdCurrentTemp.toFixed(1)} K` : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Average T</div>
                <div className="mt-1 font-medium text-white">
                  {mdMeta?.avg_temperature_k != null ? `${mdMeta.avg_temperature_k.toFixed(1)} K` : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Final T</div>
                <div className="mt-1 font-medium text-white">
                  {mdMeta?.final_temperature_k != null ? `${mdMeta.final_temperature_k.toFixed(1)} K` : "—"}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <LiveMSDChart
                timePs={mdTimePs}
                msdNa={mdMsdNa}
                msdNonNa={mdMsdNonNa}
                live={mdLive}
              />
            </div>
          </div>
        )}

        {synthesisRoute && (
          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-amber-400">Solid-state synthesis route</h2>
              <p className="text-sm text-slate-300">
                Formula: <span className="text-white font-medium">{synthesisRoute.formula}</span>
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-300">
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Batch size</div>
                <div className="mt-1 font-medium text-white">
                  {formatNumber(synthesisRoute.batch_mmol, 2)} mmol
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Na excess fraction</div>
                <div className="mt-1 font-medium text-white">
                  {formatNumber(synthesisRoute.na_excess_fraction, 3)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/30 border border-slate-700 p-4">
                <div className="text-slate-400">Na excess percent</div>
                <div className="mt-1 font-medium text-white">
                  {(100 * synthesisRoute.na_excess_fraction).toFixed(0)}%
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 text-sm font-medium text-slate-200">
                Precursor amounts
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/50 text-slate-400">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Element</th>
                      <th className="text-left px-4 py-3 font-medium">Precursor</th>
                      <th className="text-left px-4 py-3 font-medium">mmol</th>
                      <th className="text-left px-4 py-3 font-medium">Mass (g)</th>
                      <th className="text-left px-4 py-3 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {synthesisRoute.precursors.map((p, idx) => (
                      <tr
                        key={`${p.element}-${idx}`}
                        className="border-t border-slate-800 text-slate-200"
                      >
                        <td className="px-4 py-3">{p.element}</td>
                        <td className="px-4 py-3 font-medium text-white">{p.precursor}</td>
                        <td className="px-4 py-3">{formatNumber(p.mmol_precursor, 4)}</td>
                        <td className="px-4 py-3">{formatNumber(p.mass_g, 4)}</td>
                        <td className="px-4 py-3 text-slate-400">{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-medium text-slate-200">Suggested procedure</div>
                <button
                  type="button"
                  onClick={() => downloadText("synthesis_route.txt", synthesisRoute.procedure)}
                  className="px-3 py-2 rounded-xl text-sm border transition bg-slate-900/50 border-slate-700 text-slate-200 hover:border-slate-500"
                >
                  Download route
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-300 font-sans">
                {synthesisRoute.procedure}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}