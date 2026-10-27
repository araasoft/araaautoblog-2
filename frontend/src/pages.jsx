import {useEffect,useMemo,useState} from "react";
import {Link,useParams} from "react-router-dom";
import {Search,ArrowRight,ChevronDown,Sparkles,Calendar,Clock,User,Eye,Share2,SearchX} from "lucide-react";
import {useDb,list,title,body,tags,mins,img,label,date,fmt,bump,SOURCES} from "./lib.js";
import {Reveal,Head,Sk,BlogCard,Feat,NewsCard,Photo} from "./ui.jsx";
import {SubscribeBox} from "./Subscribe.jsx";
import {Engage,Comments} from "./Client.jsx";
import {useSearchParams} from "react-router-dom";
import {useAuth,openAuth,useSeo,SITE,homeLd,listLd,postMeta,tags as hashTags} from "./lib.js";
import {Bookmark,Lock} from "lucide-react";

const wrap="mx-auto w-full max-w-[1180px] 2xl:max-w-[1360px] px-4 sm:px-6 lg:px-8";
const grid="grid gap-4 sm:gap-[22px] grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))]";
/* posts = blogs, analytics/posts = news */
const useBlogs=()=>{const p=useDb("posts"),m=useDb("blogs_meta"),lk=useDb("blog_likes");
  return {loaded:!!p,blogs:list(p).sort((a,b)=>b.createdAt-a.createdAt),views:id=>m?.[id]?.views||0,likes:id=>Object.keys(lk?.[id]||{}).length}};
const useNews=()=>{const a=useDb("analytics/posts"),p=useDb("posts");
  return {loaded:!!a,news:list(a).sort((x,y)=>y.at-x.at),pic:id=>img(p?.[id]||{})}};

export function HomePage(){
  useSeo({path:"/",ld:homeLd(SITE)});
  const {loaded,blogs,views,likes}=useBlogs(),{news,pic}=useNews();
  return <div className="animate-rise">
    <section className="relative grid min-h-[100svh] place-items-center overflow-hidden px-4 pt-28 pb-20 text-center">
      <div className="absolute -left-40 -top-28 size-[320px] sm:size-[560px] rounded-full bg-b/60 blur-[90px] animate-float"/>
      <div className="absolute -right-20 top-[28%] size-[220px] sm:size-[340px] rounded-full bg-y/30 blur-[90px] animate-float [animation-delay:-5s]"/>
      <div className="absolute aspect-square w-[min(760px,130vw)] rounded-full border border-dashed border-w/10 animate-orbit"/>
      <div className="absolute aspect-square w-[min(520px,95vw)] rounded-full border border-dashed border-w/10 animate-orbit [animation-direction:reverse] [animation-duration:36s]"/>
      <div className="relative max-w-[860px] [&>*]:animate-rise">
        <img src="/logo.png" alt="" className="mx-auto size-[72px] sm:size-[92px] object-contain drop-shadow-[0_10px_30px_rgba(41,72,194,.8)]"/>
        <div style={{animationDelay:".12s"}} className="mx-auto my-5 inline-flex items-center gap-2 rounded-full border border-w/10 bg-w/5 px-4 py-2 text-sm text-y"><Sparkles size={15}/>Innovation in Technology</div>
        <h1 style={{animationDelay:".24s"}} className="text-[clamp(40px,8vw,84px)]">Insights that move your <em className="not-italic bg-gradient-to-r from-y to-white bg-clip-text text-transparent">business</em> forward</h1>
        <p style={{animationDelay:".36s"}} className="mx-auto mt-5 mb-8 max-w-[560px] text-base sm:text-lg text-w/70">AI, custom software and tech stories from Araa Softwares, written for growing companies.</p>
        <div style={{animationDelay:".48s"}} className="flex flex-wrap justify-center gap-3 max-sm:[&>*]:w-full"><Link to="/blogs" className="btn pri">Explore blogs <ArrowRight size={17}/></Link><a href="#latest" className="btn ghost">Latest stories <ChevronDown size={17}/></a></div></div></section>
    <section id="latest" className={`${wrap} pt-16`}><Head eye="Fresh from the blog" h="Latest 5 stories"/>
      {loaded?blogs.slice(0,5).map((p,i)=><Feat key={p.id} p={p} i={i} views={views(p.id)} likes={likes(p.id)}/>):<div className="sk h-72"/>}</section>
    <section className={`${wrap} pt-16`}><Head eye="Keep reading" h="Blogs"/>
      <div className={grid}>{loaded?blogs.slice(0,10).map((p,i)=><BlogCard key={p.id} p={p} i={i} views={views(p.id)} likes={likes(p.id)}/>):<Sk/>}</div>
      <Reveal className="my-11 text-center"><Link to="/blogs" className="btn pri">More blogs <ArrowRight size={17}/></Link></Reveal></section>
    <section className={`${wrap} pt-10`}><Head eye="Social performance" h="Latest news"/>
      <div className={grid}>{news.slice(0,6).map((n,i)=><NewsCard key={n.id} n={n} i={i} pic={pic(n.id)}/>)}</div>
      <Reveal className="my-11 text-center"><Link to="/news" className="btn ghost">All news <ArrowRight size={17}/></Link></Reveal></section>
    <section className={`${wrap} pt-6`}><SubscribeBox source="home"/></section></div>;
}

function Tools({term,set,children}){return <div className="mb-7 flex flex-wrap justify-between gap-3 max-sm:flex-col">
  <label className="flex h-12 min-w-[min(320px,100%)] items-center gap-2.5 rounded-full border border-w/10 bg-w/5 px-4 transition focus-within:border-y"><Search size={17}/><input value={term} onChange={e=>set(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none"/></label>{children}</div>}
const Empty=()=><div className="col-span-full grid justify-items-center gap-4 py-16 text-w/60"><SearchX/><p>Nothing found.</p></div>;

export function BlogsPage(){
  const [q]=useSearchParams(),{loaded,blogs,views,likes}=useBlogs(),[term,setTerm]=useState(q.get("q")||""),[n,setN]=useState(12),fav=q.get("fav")==="1",{user}=useAuth(),saved=useDb(user?`blog_favs/${user.uid}`:null);
  const l=blogs.filter(p=>(!fav||saved?.[p.id])&&(title(p)+body(p.text)).toLowerCase().includes(term.toLowerCase()));
  useSeo({t:fav?"Saved blogs":"All Blogs on AI, Software & Tech",d:"Browse every AraaBlogs article on AI, custom software, web and mobile apps and technology from Araa Softwares.",path:"/blogs",noindex:fav||!!q.get("q"),ld:listLd(SITE,blogs)});
  return <div className={`${wrap} pt-[100px] sm:pt-[120px] animate-rise`}>
    <div className="mb-8 grid gap-2.5"><span className="eyebrow">AraaBlogs</span><h1 className="text-[clamp(30px,5vw,54px)]">{fav?"Saved blogs":"All blogs"}</h1></div>
    <Tools term={term} set={v=>{setTerm(v);setN(12)}}><div className="flex gap-2"><Link to="/blogs" className={`chip ${fav?"":"on"}`}>All</Link><Link to="/blogs?fav=1" className={`chip ${fav?"on":""}`}><Bookmark size={15}/>Saved</Link></div></Tools>
    <div className={grid} key={String(fav)}>{fav&&user===null?<div className="col-span-full grid justify-items-center gap-4 py-16 text-w/60"><Lock/><p>Log in to see your saved blogs.</p><button onClick={()=>openAuth("login")} className="btn pri">Login</button></div>
      :!loaded?<Sk n={8}/>:l.length?l.slice(0,n).map((p,i)=><BlogCard key={p.id} p={p} i={i} views={views(p.id)} likes={likes(p.id)}/>):<Empty/>}</div>
    {l.length>n&&<div className="my-11 text-center"><button onClick={()=>setN(n+12)} className="btn pri">Load more</button></div>}</div>;
}

export function NewsPage(){
  useSeo({t:"Latest news",d:"Latest AraaBlogs news and social performance.",path:"/news",noindex:true});
  const {loaded,news,pic}=useNews(),[term,setTerm]=useState(""),[src,setSrc]=useState("all");
  const l=news.filter(n=>(src==="all"||n.source===src)&&(title(n)+body(n.text)).toLowerCase().includes(term.toLowerCase()));
  return <div className={`${wrap} pt-[100px] sm:pt-[120px] animate-rise`}>
    <div className="mb-8 grid gap-2.5"><span className="eyebrow">Analytics</span><h1 className="text-[clamp(30px,5vw,54px)]">News</h1></div>
    <Tools term={term} set={setTerm}><div className="flex gap-2 overflow-x-auto">{["all",...SOURCES].map(s=><button key={s} onClick={()=>setSrc(s)} className={`chip ${src===s?"on":""}`}>{s==="all"?"All":label(s)}</button>)}</div></Tools>
    <div className={grid} key={src}>{!loaded?<Sk n={6}/>:l.length?l.map((n,i)=><NewsCard key={n.id} n={n} i={i} pic={pic(n.id)}/>):<Empty/>}</div></div>;
}

export function BlogPage(){
  const {id}=useParams(),{loaded,blogs,views,likes}=useBlogs(),p=blogs.find(x=>x.id===id);
  useEffect(()=>{window.scrollTo(0,0);if(!id||sessionStorage.getItem("v:"+id))return;sessionStorage.setItem("v:"+id,1);bump(`blogs_meta/${id}/views`)},[id]);
  useSeo(loaded?(p?postMeta(p,SITE):{t:"Article not found",path:`/blogs/${id}`,noindex:true}):null);
  if(!loaded) return <div className="animate-pop"><div className="sk h-[60vh] !rounded-none"/></div>;
  if(!p) return <div className={`${wrap} pt-32 text-center`}><p className="mb-5 text-w/60">Article not found.</p><Link to="/blogs" className="btn pri">All blogs</Link></div>;
  const mine=hashTags(p.text),related=blogs.filter(x=>x.id!==id).map(x=>({x,s:hashTags(x.text).filter(t=>mine.includes(t)).length})).sort((a,b)=>b.s-a.s||(b.x.createdAt||0)-(a.x.createdAt||0)).slice(0,3).map(o=>o.x);
  const share=async()=>{const u=location.href;try{navigator.share?await navigator.share({url:u}):await navigator.clipboard.writeText(u)}catch{}};
  return <article className="animate-rise">
    <div className="relative flex min-h-[60vh] sm:min-h-[min(74vh,620px)] items-end bg-gradient-to-br from-b to-n">
      <Photo p={p} alt={title(p)} className="fade-img absolute inset-0"/>
      <div className="absolute inset-0 bg-gradient-to-b from-n/30 via-n/50 to-n"/>
      <div className="relative mx-auto grid w-full max-w-[780px] justify-items-start gap-3.5 px-4 pb-6 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-w/70"><Link to="/" className="hover:text-y">Home</Link>/<Link to="/blogs" className="hover:text-y">Blogs</Link></nav>
        <span className="rounded-full bg-y px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-n">{label(p.source)}</span>
        <h1 className="text-[clamp(30px,6vw,56px)]">{title(p)}</h1>
        <div className="flex flex-wrap gap-4 text-sm text-w/75"><span className="inline-flex items-center gap-1.5"><Calendar size={15}/><time dateTime={new Date(p.createdAt).toISOString()}>{date(p.createdAt)}</time></span><span className="inline-flex items-center gap-1.5"><Clock size={15}/>{mins(p)} min read</span>{p.author?.name&&<span className="inline-flex items-center gap-1.5"><User size={15}/>{p.author.name}</span>}</div></div></div>
    <div className="mx-auto w-full max-w-[780px] px-4 sm:px-6">
      <div className="mb-8 flex flex-wrap gap-2.5 border-b border-w/10 py-4"><Engage id={id} views={fmt(views(id))}/><button onClick={share} className="chip hover:bg-w/10"><Share2 size={15}/>Share</button></div>
      <div className="text-[17px] sm:text-[19px] leading-[1.75] text-w/90">{body(p.text).split(/\n\n+/).map((t,i)=><Reveal key={i} className="mb-4 whitespace-pre-line">{t}</Reveal>)}</div>
      <div className="mt-6 flex flex-wrap gap-2">{tags(p.text).map(t=><span key={t} className="chip text-y">{t}</span>)}</div>
      <Comments id={id}/>
      {related.length>0&&<section className="mt-16"><h2 className="mb-6 text-3xl">Keep reading</h2><div className={grid}>{related.map((r,i)=><BlogCard key={r.id} p={r} i={i} views={views(r.id)} likes={likes(r.id)}/>)}</div></section>}<div className="mt-16"><SubscribeBox source="article"/></div></div></article>;
}
