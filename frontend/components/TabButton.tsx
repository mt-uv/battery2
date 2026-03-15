export default function TabButton({
  active,
  label,
  onClick
}:{
  active:boolean
  label:string
  onClick:()=>void
}){

  return(
    <button
      onClick={onClick}
      className={
        active
          ? "px-4 py-2 rounded-xl bg-indigo-600 text-white"
          : "px-4 py-2 rounded-xl border border-slate-700 text-slate-300"
      }
    >
      {label}
    </button>
  )
}