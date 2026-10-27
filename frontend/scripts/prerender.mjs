/* Runs after `vite build`. Fetches posts from Firebase (public REST read) and writes:
   static HTML per page (real <title>, meta, JSON-LD and readable content for crawlers),
   sitemap.xml (with images + lastmod), feed.xml (RSS) and robots.txt. */
import fs from "node:fs";import path from "node:path";
import {body,tags,title,excerpt,mins,img,cut,postMeta,homeLd,listLd,org,DEF_T,DEF_D,BRAND} from "../src/shared.js";

const env={...(fs.existsSync(".env")?Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>/^\w+=/.test(l)).map(l=>[l.split("=")[0],l.slice(l.indexOf("=")+1).trim()])):{}),...process.env};
const SITE=(env.VITE_SITE_URL||"").replace(/\/$/,"");
if(!SITE) console.warn("⚠ Set VITE_SITE_URL (e.g. https://blogs.example.com) for correct canonical/sitemap URLs.");
const site=SITE||"https://example.com";
const DB=(env.VITE_FB_DB_URL||"https://page-araasoftwares-default-rtdb.firebaseio.com").replace(/\/$/,"");
const dist=path.resolve("dist"),tpl=fs.readFileSync(path.join(dist,"index.html"),"utf8");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const abs=u=>/^https?:/.test(u)?u:site+u;

let posts=[];
try{const j=await (await fetch(DB+"/posts.json")).json();
  posts=Object.entries(j||{}).map(([id,p])=>({...p,id})).filter(p=>p.text).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}catch(e){console.warn("⚠ Could not fetch posts:",e.message)}

const headTags=m=>{
  const t=m.t?`${m.t} | ${BRAND}`:DEF_T,d=m.d||DEF_D,url=site+(m.path||"/"),im=abs(m.image||"/logo.png");
  return `<title>${esc(t)}</title>
<meta name="description" content="${esc(d)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${m.noindex?"noindex,follow":"index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"}">
${m.keywords?.length?`<meta name="keywords" content="${esc(m.keywords.join(", "))}">\n`:""}<meta property="og:site_name" content="${BRAND}"><meta property="og:locale" content="en_US">
<meta property="og:type" content="${m.type||"website"}"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(d)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(im)}">
${m.pub?`<meta property="article:published_time" content="${m.pub}"><meta property="article:modified_time" content="${m.mod||m.pub}">\n`:""}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(t)}"><meta name="twitter:description" content="${esc(d)}"><meta name="twitter:image" content="${esc(im)}">
<script id="ld" type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@graph":[org(site),...(m.ld||[])]}).replace(/</g,"\\u003c")}</script>`;
};
const shell=h=>`<div style="max-width:780px;margin:0 auto;padding:110px 16px 60px;color:#fbfdfc;font:17px/1.7 Inter,system-ui,sans-serif">${h}</div>`;
const link=p=>`<li><a style="color:#F4D532" href="/blogs/${encodeURIComponent(p.id)}">${esc(title(p))}</a> <small>${esc(excerpt(p))}</small></li>`;
function write(route,m,html){
  const out=tpl.replace(/<!--seo-start-->[\s\S]*?<!--seo-end-->/,`<!--seo-start-->\n${headTags(m)}\n<!--seo-end-->`).replace('<div id="root"></div>',`<div id="root">${shell(html)}</div>`);
  const f=path.join(dist,route==="/"?"":route.slice(1),"index.html");fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,out);
}

for(const p of posts){
  const m=postMeta(p,site),paras=body(p.text).split(/\n\n+/).map(t=>`<p>${esc(t).replace(/\n/g,"<br>")}</p>`).join("");
  const related=posts.filter(x=>x.id!==p.id).slice(0,3).map(link).join("");
  write("/blogs/"+p.id,m,`<nav aria-label="Breadcrumb"><a href="/" style="color:#F4D532">Home</a> / <a href="/blogs" style="color:#F4D532">Blogs</a></nav>
<article><h1>${esc(title(p))}</h1><p><time datetime="${m.pub}">${new Date(p.createdAt).toDateString()}</time> · ${mins(p)} min read</p>
${img(p)?`<img src="${esc(img(p))}" alt="${esc(title(p))}" width="1080" height="720" style="max-width:100%;height:auto;border-radius:20px">`:""}${paras}<p>${tags(p.text).map(esc).join(" ")}</p></article>
${related?`<h2>Keep reading</h2><ul>${related}</ul>`:""}`);
}
write("/blogs",{t:"All Blogs on AI, Software & Tech",d:"Browse every AraaBlogs article on AI, custom software, web and mobile apps and technology from Araa Softwares.",path:"/blogs",ld:listLd(site,posts)},
  `<h1>All articles</h1><ul>${posts.map(link).join("")}</ul>`);
write("/",{path:"/",ld:homeLd(site)},`<h1>Insights that move your business forward</h1><p>${esc(DEF_D)}</p><h2>Latest stories</h2><ul>${posts.slice(0,10).map(link).join("")}</ul>`);

/* sitemap.xml with lastmod + image extension */
const url=(loc,mod,pri,im)=>`<url><loc>${esc(site+loc)}</loc>${mod?`<lastmod>${new Date(mod).toISOString()}</lastmod>`:""}<priority>${pri}</priority>${im?`<image:image><image:loc>${esc(im)}</image:loc></image:image>`:""}</url>`;
fs.writeFileSync(path.join(dist,"sitemap.xml"),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${url("/",posts[0]?.createdAt,"1.0")}\n${url("/blogs",posts[0]?.createdAt,"0.9")}\n${posts.map(p=>url("/blogs/"+encodeURIComponent(p.id),p.createdAt,"0.8",img(p))).join("\n")}\n</urlset>\n`);
/* RSS */
fs.writeFileSync(path.join(dist,"feed.xml"),`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${BRAND}</title><link>${site}/</link><description>${esc(DEF_D)}</description><language>en</language>\n${posts.slice(0,30).map(p=>`<item><title>${esc(title(p))}</title><link>${esc(site+"/blogs/"+encodeURIComponent(p.id))}</link><guid isPermaLink="true">${esc(site+"/blogs/"+encodeURIComponent(p.id))}</guid><pubDate>${new Date(p.createdAt).toUTCString()}</pubDate><description>${esc(cut(body(p.text),300))}</description></item>`).join("\n")}\n</channel></rss>\n`);
fs.writeFileSync(path.join(dist,"robots.txt"),`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${site}/sitemap.xml\n`);
console.log(`✔ prerendered ${posts.length} posts + sitemap.xml, feed.xml, robots.txt`);
