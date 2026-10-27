import {useState} from "react";
import {Mail,User,Bell,Check,Trash2,UserPlus,UserMinus,Lock,LogOut} from "lucide-react";
import {db,ref,set,remove,useDb,list,date,useAuth,adminLogin,adminLogout,useSeo} from "./lib.js";
import {Reveal} from "./ui.jsx";

const ok=e=>/^\S+@\S+\.\S+$/.test(e);
const token=()=>Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10);
/* key = email, so public forms never need to READ the subscriber list */
const key=e=>e.trim().toLowerCase().replace(/[.#$\[\]\/]/g,",");

export async function addSub({name,email,notify,source="web"}){
  email=email.trim().toLowerCase();
  if(!ok(email)) throw "Enter a valid email.";
  await set(ref(db,"subscribers/"+key(email)),{name:name.trim(),email,notify,active:true,at:Date.now(),source,token:token()});
}
export const removeSub=email=>{if(!ok(email.trim()))throw "Enter a valid email.";return remove(ref(db,"subscribers/"+key(email)))};

export function SubscribeBox({source="web"}){
  const [mode,setMode]=useState("add"),[f,setF]=useState({name:"",email:"",notify:true}),
  [msg,setMsg]=useState(null),[busy,setBusy]=useState(false),add=mode==="add";
  const go=async e=>{e.preventDefault();setBusy(true);setMsg(null);
    try{add?await addSub({...f,source}):await removeSub(f.email);
      setMsg({ok:1,t:add?"You're subscribed. Welcome aboard!":"Done. This email won't receive updates."});setF({name:"",email:"",notify:true});}
    catch(x){setMsg({t:typeof x==="string"?x:"Something went wrong. Try again."})}setBusy(false)};
  return <Reveal className="relative overflow-hidden rounded-[36px] border border-w/10 bg-gradient-to-br from-b/50 to-n p-6 sm:p-10">
    <div className="absolute -right-20 -top-20 size-72 rounded-full bg-y/20 blur-3xl animate-float"/>
    <div className="relative grid gap-8 md:grid-cols-2 items-center">
      <div className="grid gap-3"><span className="eyebrow">Newsletter</span><h2 className="text-[clamp(28px,4vw,44px)]">Get new stories in your inbox</h2><p className="text-w/70">AI, custom software and tech insights from Araa Softwares. Leave any time.</p>
        <div className="mt-2 inline-flex w-fit rounded-full border border-w/10 bg-w/5 p-1 text-sm">
          {[["add","Subscribe",UserPlus],["rm","Unsubscribe",UserMinus]].map(([k,t,I])=><button key={k} onClick={()=>{setMode(k);setMsg(null)}} className={`flex items-center gap-1.5 rounded-full px-4 py-2 transition ${mode===k?"bg-y text-n font-semibold":"text-w/70"}`}><I size={15}/>{t}</button>)}</div></div>
      <form onSubmit={go} className="grid gap-3" key={mode}>
        {add&&<label className="relative animate-pop"><User size={17} className="absolute left-4 top-[18px] text-w/40"/><input className="input pl-11" placeholder="Your name" value={f.name} onChange={e=>setF({...f,name:e.target.value})} required/></label>}
        <label className="relative animate-pop"><Mail size={17} className="absolute left-4 top-[18px] text-w/40"/><input type="email" className="input pl-11" placeholder="Email address" value={f.email} onChange={e=>setF({...f,email:e.target.value})} required/></label>
        {add&&<button type="button" onClick={()=>setF({...f,notify:!f.notify})} className="flex items-center gap-3 rounded-2xl border border-w/10 bg-w/5 p-3.5 text-left text-sm animate-pop">
          <Bell size={18} className={f.notify?"text-y":"text-w/40"}/><span className="flex-1">Notify me when new articles are published</span>
          <span className={`h-6 w-11 rounded-full p-0.5 transition-colors ${f.notify?"bg-y":"bg-w/20"}`}><span className={`block size-5 rounded-full bg-n shadow transition-transform duration-300 ${f.notify?"translate-x-5":""}`}/></span></button>}
        <button disabled={busy} className="btn pri">{add?"Subscribe":"Unsubscribe"}</button>
        <p className={`min-h-5 text-sm transition-opacity ${msg?"opacity-100":"opacity-0"} ${msg?.ok?"text-emerald-400":"text-red-400"}`}>{msg?.ok&&<Check size={14} className="mr-1 inline"/>}{msg?.t}</p></form></div></Reveal>;
}

/* /admin: private. Login required, and only ADMINS emails see subscribers */
function Login(){
  const [f,setF]=useState({e:"",p:""}),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
  const go=async x=>{x.preventDefault();setBusy(true);setErr("");try{await adminLogin(f.e.trim(),f.p)}catch{setErr("Wrong email or password.")}setBusy(false)};
  return <form onSubmit={go} className="mx-auto grid max-w-sm gap-3 rounded-[30px] border border-w/10 bg-w/5 p-7 text-center animate-pop">
    <div className="mx-auto grid size-14 place-items-center rounded-full bg-n shadow-[0_10px_24px_-8px_#2948C2]"><Lock size={22}/></div><h1 className="text-2xl">Admin login</h1>
    <input type="email" required className="input" placeholder="Email" value={f.e} onChange={x=>setF({...f,e:x.target.value})}/>
    <input type="password" required className="input" placeholder="Password" value={f.p} onChange={x=>setF({...f,p:x.target.value})}/>
    <p className="min-h-5 text-sm text-red-400">{err}</p><button disabled={busy} className="btn pri">Login</button></form>;
}

export function Admin(){
  useSeo({t:"Admin",path:"/admin",noindex:true});
  const {user,loading,isAdmin}=useAuth(),subs=useDb(isAdmin?"subscribers":null),all=list(subs).sort((a,b)=>b.at-a.at);
  const shell=c=><div className="mx-auto w-full max-w-[1180px] 2xl:max-w-[1360px] px-4 sm:px-6 lg:px-8 pt-[100px] sm:pt-[120px] animate-rise">{c}</div>;
  if(loading) return shell(<div className="sk mx-auto h-72 max-w-sm"/>);
  if(!user) return shell(<Login/>);
  if(!isAdmin) return shell(<div className="mx-auto grid max-w-sm justify-items-center gap-4 text-center"><Lock/><p className="text-w/70">This account isn't authorised.</p><button onClick={adminLogout} className="btn ghost">Log out</button></div>);
  return shell(<>
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3"><div className="grid gap-2.5"><span className="eyebrow">Admin</span><h1 className="text-[clamp(30px,5vw,54px)]">Subscribers {subs&&<span className="text-y">({all.length})</span>}</h1></div>
      <button onClick={adminLogout} className="btn ghost sm"><LogOut size={15}/>Log out</button></div>
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] items-start"><SubscribeBox source="admin"/>
      <div className="grid gap-3">{!subs?Array.from({length:3},(_,i)=><div key={i} className="sk h-20"/>):all.length===0?<p className="text-w/60">No subscribers yet.</p>:
        all.map((s,i)=><div key={s.id} style={{animationDelay:i*60+"ms"}} className="flex items-center gap-4 rounded-3xl border border-w/10 bg-w/5 p-4 animate-rise">
          <div className="grid size-11 place-items-center rounded-full bg-b font-semibold">{(s.name||s.email)[0].toUpperCase()}</div>
          <div className="min-w-0 flex-1"><b className="block truncate">{s.name||"No name"}</b><span className="block truncate text-sm text-w/60">{s.email}</span>
            <span className="mt-1 flex items-center gap-3 text-xs text-w/45"><span className="inline-flex items-center gap-1"><Bell size={12}/>{s.notify===false?"Off":"On"}</span>{date(s.at)} · {s.source}</span></div>
          <button onClick={()=>remove(ref(db,"subscribers/"+s.id))} title="Remove" className="grid size-10 place-items-center rounded-full text-w/50 transition hover:bg-red-500/15 hover:text-red-400"><Trash2 size={18}/></button></div>)}</div></div></>);
}
