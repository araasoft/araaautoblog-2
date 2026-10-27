import {useEffect,useState} from "react";
import {body,tags,title,excerpt,mins,img,org,DEF_T,DEF_D,BRAND} from "./shared.js";
export {body,tags,title,excerpt,mins,img,homeLd,listLd,postMeta,crumbs} from "./shared.js";
import {initializeApp} from "firebase/app";
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,updateProfile,sendPasswordResetEmail,GoogleAuthProvider,signInWithPopup,signOut} from "firebase/auth";
import {getDatabase,ref,onValue,set,remove,push,runTransaction} from "firebase/database";
const app=initializeApp({
  apiKey:import.meta.env.VITE_FB_API_KEY||"AIzaSyCwczFlPFNVBWUxgMwLBIBuMAtiDFOcNss",
  authDomain:"page-araasoftwares.firebaseapp.com",
  databaseURL:import.meta.env.VITE_FB_DB_URL||"https://page-araasoftwares-default-rtdb.firebaseio.com",
  projectId:"page-araasoftwares",appId:"1:1076512739243:web:866a7c6e7c110c80ddccee"});
export const db=getDatabase(app);
export const SITE=(import.meta.env.VITE_SITE_URL||location.origin).replace(/\/$/,"");
export {ref,set,remove,push,runTransaction};
/* live Firebase subscription: null while loading */
export const useDb=path=>{const [d,setD]=useState(null);
  useEffect(()=>{if(!path)return;return onValue(ref(db,path),s=>setD(s.val()||{}),()=>setD({}))},[path]);return d;};
export const list=o=>Object.entries(o||{}).map(([id,v])=>({...v,id}));
export const fmt=n=>n>=1000?(n/1000).toFixed(1).replace(".0","")+"k":n||0;
export const date=ms=>new Date(ms).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
export const bump=path=>runTransaction(ref(db,path),v=>(v||0)+1).catch(()=>{});
const SRC={ai:"AI",manual:"Manual",automation:"Automation",breaking:"Breaking"};
export const label=s=>SRC[s]||s||"Post";
export const SOURCES=Object.keys(SRC);

/* ---- admin auth: only listed emails see the subscriber manager ---- */
export const auth=getAuth(app);
export const ADMINS=(import.meta.env.VITE_ADMIN_EMAILS||"sahranrock8@gmail.com").split(",").map(e=>e.trim().toLowerCase());
export const adminLogin=(e,p)=>signInWithEmailAndPassword(auth,e,p);
export const adminLogout=()=>signOut(auth);
export const useAuth=()=>{const [u,setU]=useState(undefined);useEffect(()=>onAuthStateChanged(auth,setU),[]);
  return {user:u,loading:u===undefined,isAdmin:!!u&&ADMINS.includes((u.email||"").toLowerCase())};};

/* ---- client (reader) accounts ---- */
export const userName=u=>u.displayName||(u.email||"User").split("@")[0];
export const signup=async(name,e,p)=>{const c=await createUserWithEmailAndPassword(auth,e,p);await updateProfile(c.user,{displayName:name});return c};
export const googleLogin=()=>signInWithPopup(auth,new GoogleAuthProvider());
export const resetPass=e=>sendPasswordResetEmail(auth,e);
export const openAuth=(m="login")=>dispatchEvent(new CustomEvent("auth:open",{detail:m}));
export const toast=m=>dispatchEvent(new CustomEvent("toast",{detail:m}));

/* ---- auto images: own image -> Unsplash (if key) -> Wikimedia Commons (CC0/Public Domain only) -> Picsum (free photos) ---- */
const KW={businessgrowth:"business growth",customsoftware:"software code",techsolutions:"technology",innovation:"innovation",aiinsights:"artificial intelligence",aiupdate:"artificial intelligence",techpolicy:"government",futureofwork:"office work",techupdate:"technology",startuptips:"startup",techadvice:"computer",leanlaunch:"startup",learningculture:"learning"};
const imgQuery=p=>[...new Set(tags(p.text).map(x=>x.slice(1).toLowerCase()).filter(x=>!x.includes("araa")).map(x=>KW[x]||x))].slice(0,2).join(" ")||"technology";
const hash=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
const mem=new Map();let chain=Promise.resolve();
const ls={get:k=>{try{return localStorage.getItem("img:"+k)||""}catch{return ""}},set:(k,v)=>{try{localStorage.setItem("img:"+k,v)}catch{}}};
async function fetchImg(p){
  const q=imgQuery(p),key=import.meta.env.VITE_UNSPLASH_KEY;
  try{if(key){const j=await (await fetch(`https://api.unsplash.com/photos/random?orientation=landscape&query=${encodeURIComponent(q)}&client_id=${key}`)).json();if(j.urls?.regular)return j.urls.regular}}catch{}
  try{const j=await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q+" filetype:bitmap")}&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1080&format=json&origin=*`)).json();
    const ok=Object.values(j.query?.pages||{}).map(x=>x.imageinfo?.[0]).filter(i=>i&&/jpeg/.test(i.mime)&&i.width>=1000&&i.width>=i.height&&/cc0|public domain|^pd/i.test(i.extmetadata?.LicenseShortName?.value||""));
    if(ok.length)return ok[hash(p.id)%ok.length].thumburl}catch{}
  return `https://picsum.photos/seed/${encodeURIComponent(p.id)}/1080/720`;
}
const resolveImg=p=>{const c=mem.get(p.id)||ls.get(p.id);if(c){mem.set(p.id,c);return Promise.resolve(c)}
  const r=chain.then(()=>fetchImg(p)).then(u=>{mem.set(p.id,u);ls.set(p.id,u);return u});chain=r.catch(()=>{});return r};
export function useImage(p){
  const own=img(p),[u,setU]=useState(own||mem.get(p.id)||ls.get(p.id));
  useEffect(()=>{if(own||u)return;let on=true;resolveImg(p).then(x=>on&&setU(x));return()=>{on=false}},[own,p.id]);
  return own||u||"";
}

/* ---- SEO: per-route title, description, canonical, robots, OG/Twitter, JSON-LD (pass null to skip) ---- */
const metaTag=(k,v)=>{const a=/^(og|article):/.test(k)?"property":"name";let e=document.head.querySelector(`meta[${a}="${k}"]`);
  if(!e){e=document.createElement("meta");e.setAttribute(a,k);document.head.appendChild(e)}e.setAttribute("content",v)};
export function useSeo(m){
  const k=JSON.stringify(m);
  useEffect(()=>{
    if(!m)return;const {t,d=DEF_D,path="/",image="/logo.png",type="website",ld=[],noindex=false,pub="",mod="",keywords=[],author=""}=m;
    const title=t?`${t} | ${BRAND}`:DEF_T,url=SITE+path,im=/^https?:/.test(image)?image:SITE+image;
    document.title=title;
    let c=document.head.querySelector('link[rel="canonical"]');if(!c){c=document.createElement("link");c.rel="canonical";document.head.appendChild(c)}c.href=url;
    metaTag("description",d);
    metaTag("robots",noindex?"noindex,follow":"index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    metaTag("og:title",title);metaTag("og:description",d);metaTag("og:url",url);metaTag("og:image",im);metaTag("og:type",type);metaTag("og:locale","en_US");metaTag("og:site_name",BRAND);
    metaTag("twitter:card","summary_large_image");metaTag("twitter:title",title);metaTag("twitter:description",d);metaTag("twitter:image",im);
    if(keywords.length)metaTag("keywords",keywords.join(", "));
    if(pub){metaTag("article:published_time",pub);metaTag("article:modified_time",mod||pub);if(author)metaTag("article:author",author)}
    let s=document.getElementById("ld");if(!s){s=document.createElement("script");s.id="ld";s.type="application/ld+json";document.head.appendChild(s)}
    s.textContent=JSON.stringify({"@context":"https://schema.org","@graph":[org(SITE),...ld]}).replace(/</g,"\\u003c");
  },[k]);
}
