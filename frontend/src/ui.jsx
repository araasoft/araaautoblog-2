import {useEffect,useRef,useState} from "react";
import {Link,NavLink} from "react-router-dom";
import {Home,Newspaper,BookOpen,Users,Heart,Eye,Clock,ArrowUpRight,ArrowRight,Share2,Zap} from "lucide-react";
import {UserMenu} from "./Client.jsx";
import {useAuth,useImage,fmt,title,excerpt,mins,img,label,date} from "./lib.js";

export function Reveal({as:T="div",d=0,className="",children,...r}){
  const el=useRef(),[on,setOn]=useState(false);
  useEffect(()=>{const o=new IntersectionObserver(([e])=>setOn(e.isIntersecting),{threshold:.12,rootMargin:"0px 0px -6% 0px"});o.observe(el.current);return()=>o.disconnect()},[]);
  return <T ref={el} style={{transitionDelay:d+"ms"}} {...r}
    className={`transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)] ${on?"opacity-100 translate-y-0":"opacity-0 translate-y-12"} ${className}`}>{children}</T>;
}
export function Photo({p,alt="",className=""}){
  const src=useImage(p),[ok,setOk]=useState(false);
  useEffect(()=>{setOk(false);if(!src)return;const i=new Image();i.onload=()=>setOk(true);i.src=src},[src]);
  return <div {...(alt?{role:"img","aria-label":alt}:{"aria-hidden":true})} className={`bg-cover bg-center transition-[opacity,transform] duration-1000 ease-out ${ok?"opacity-100":"opacity-0"} ${className}`} style={src?{backgroundImage:`url("${src}")`}:undefined}/>;
}
export const Head=({eye,h})=><Reveal className="grid gap-2.5 mb-8"><span className="eyebrow">{eye}</span><h2 className="text-[clamp(30px,5vw,54px)]">{h}</h2></Reveal>;
export const Sk=({n=6})=>Array.from({length:n},(_,i)=><div key={i} className="sk aspect-[4/5] sm:aspect-[3/4] !rounded-[30px]"/>);

export function Nav(){
  const [sc,setSc]=useState(false),{isAdmin}=useAuth();
  useEffect(()=>{const f=()=>setSc(scrollY>20);addEventListener("scroll",f,{passive:true});return()=>removeEventListener("scroll",f)},[]);
  const L=({to,I,t})=><NavLink to={to} end={to==="/"} className={({isActive})=>`flex items-center gap-1.5 rounded-full min-h-10 px-3 sm:px-3.5 py-2.5 text-sm transition ${isActive?"bg-w/10 text-white":"text-w/80 hover:bg-w/10"}`}><I size={17}/><span className="hidden sm:inline">{t}</span></NavLink>;
  return <nav className={`fixed z-50 left-1/2 -translate-x-1/2 w-[min(1100px,calc(100%-24px))] top-[calc(12px+env(safe-area-inset-top,0px))] flex items-center justify-between rounded-full border border-w/10 backdrop-blur-xl py-2 pl-4 pr-2 transition-colors duration-300 ${sc?"bg-n/90":"bg-n/55"}`}>
    <Link to="/" className="flex items-center gap-2.5 font-bold text-[19px]"><img src="/logo.png" alt="" className="size-9 object-contain"/><span className="max-[400px]:hidden">AraaBlogs</span></Link>
    <div className="flex items-center gap-1"><L to="/" I={Home} t="Home"/><L to="/blogs" I={BookOpen} t="Blogs"/><L to="/news" I={Newspaper} t="News"/>{isAdmin&&<L to="/admin" I={Users} t="Subscribers"/>}<UserMenu/></div></nav>;
}

export const Stats=({p,views,likes=0})=><div className="flex flex-wrap justify-center gap-3.5 text-[13px] text-w/75">
  <span className="inline-flex items-center gap-1.5"><Heart size={14}/>{fmt(likes)}</span>
  <span className="inline-flex items-center gap-1.5"><Eye size={14}/>{fmt(views)}</span>
  <span className="inline-flex items-center gap-1.5"><Clock size={14}/>{mins(p)} min</span></div>;

/* blog card: image on top fading out into the bottom, content over the fade */
export function BlogCard({p,i=0,views=0,likes=0}){
  return <Reveal as={Link} to={`/blogs/${p.id}`} d={(i%3)*90}
    className="group relative flex items-end aspect-[4/5] sm:aspect-[3/4] rounded-[30px] overflow-hidden bg-gradient-to-br from-b to-n shadow-[0_24px_50px_-24px_#000c] hover:-translate-y-2 !duration-500">
    <Photo p={p} alt={title(p)} className="fade-img absolute inset-x-0 top-0 h-[85%] group-hover:scale-110"/>
    <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% via-b/40 via-60% to-n/95"/>
    <div className="relative z-10 w-full grid gap-3 justify-items-center text-center p-5">
      <h3 className="text-xl line-clamp-3">{title(p)}</h3><Stats p={p} views={views} likes={likes}/>
      <span className="btn glassbtn w-full max-w-[210px] group-hover:gap-3">Read now <ArrowUpRight size={17}/></span></div></Reveal>;
}
export function Feat({p,i,views=0,likes=0}){
  return <Reveal as={Link} to={`/blogs/${p.id}`} className="group grid md:grid-cols-[1.1fr_1fr] gap-3.5 md:gap-9 items-center rounded-[36px] border border-w/10 bg-w/5 p-3.5 mb-6">
    <div className={`relative aspect-[16/10] rounded-[26px] overflow-hidden bg-gradient-to-br from-b to-n ${i%2?"md:order-2":""}`}>
      <Photo p={p} alt={title(p)} className="fade-img absolute inset-0 group-hover:scale-105"/></div>
    <div className="grid gap-3.5 justify-items-start px-2.5 pb-3.5 md:px-6">
      <span className="text-[40px] md:text-6xl font-bold text-y leading-none">0{i+1}</span>
      <h3 className="text-[clamp(24px,3vw,34px)]">{title(p)}</h3><p className="text-w/70 leading-relaxed">{excerpt(p)}</p>
      <Stats p={p} views={views} likes={likes}/><span className="btn pri sm">Read article <ArrowRight size={16}/></span></div></Reveal>;
}

/* news card = analytics/posts entry, joined with posts/ for the image */
export function NewsCard({n,i=0,pic}){
  const fb=n.fb||{},li=n.li||{},t=title(n);
  return <Reveal d={(i%3)*90} className="group relative overflow-hidden rounded-[28px] border border-w/10 bg-w/5 hover:-translate-y-1.5 hover:border-y/40 !duration-500">
    <Photo p={{...n,imageUrl:pic||""}} alt={t} className="fade-img h-36 sm:h-40 group-hover:scale-105"/>
    <div className="grid gap-3 p-5">
      <div className="flex items-center justify-between text-xs"><span className="rounded-full bg-y px-3 py-1 font-bold uppercase tracking-wider text-n">{label(n.source)}</span><span className="text-w/55">{date(n.at)}</span></div>
      <h3 className="text-lg line-clamp-3">{t}</h3><p className="text-sm text-w/60 line-clamp-3">{excerpt(n)}</p>
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2 text-[13px]">
        <div className="rounded-2xl bg-n/60 p-3"><b className="text-[#6c8bff]">Facebook</b><div className="mt-1 text-w/70">{fb.likes||0} likes · {fb.shares||0} shares</div></div>
        <div className="rounded-2xl bg-n/60 p-3"><b className="text-[#4aa3ff]">LinkedIn</b><div className="mt-1 text-w/70">{fmt(li.views)} views · {fmt(li.reach)} reach</div></div></div>
      <div className="flex items-center gap-3"><Zap size={15} className="text-y"/><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-w/10"><div className="h-full rounded-full bg-y transition-all duration-1000" style={{width:Math.min(100,(n.score||0)/1.5)+"%"}}/></div><b className="text-sm">{n.score||0}</b></div>
    </div></Reveal>;
}

export const Footer=()=><footer className="mt-24 border-t border-w/10 bg-[#0c1230] pt-16 pb-8"><div className="mx-auto w-full max-w-[1180px] 2xl:max-w-[1360px] px-4 sm:px-6 lg:px-8">
  <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr] text-[15px] text-w/70">
  <div><Link to="/" className="flex items-center gap-2.5 font-bold text-[19px] text-w"><img src="/logo.png" alt="" className="size-9"/>AraaBlogs</Link><p className="mt-3 text-w/60">Innovation in Technology</p></div>
  <div className="grid gap-3"><h4 className="text-w text-[17px]">Services</h4><a href="https://araasoftwares.com/#services">Custom Software</a><a href="https://araasoftwares.com/#services">Web &amp; Mobile Apps</a><a href="https://araasoftwares.com/#services">Cloud &amp; IT Consulting</a></div>
  <div className="grid gap-3"><h4 className="text-w text-[17px]">Company</h4><a href="https://araasoftwares.com">About</a><a href="https://araasoftwares.com">Our Work</a><a href="https://araasoftwares.com">Privacy Policy</a></div>
  <div className="grid gap-3"><h4 className="text-w text-[17px]">Contact</h4><a href="mailto:araasoftwares@gmail.com">araasoftwares@gmail.com</a><span>Madurankuli, Puttalam, Sri Lanka</span><span>Offices in Sri Lanka &amp; Qatar</span></div></div>
  <div className="mt-11 border-t border-w/10 pt-6 text-sm text-w/55">© 2026 Araa Softwares (Pvt) Ltd. All rights reserved.</div></div></footer>;
