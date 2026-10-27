/* pure helpers shared by the app AND the build-time prerender script (no React/Firebase here) */
export const BRAND="AraaBlogs",ORG_NAME="Araa Softwares (Pvt) Ltd";
export const DEF_T="AraaBlogs | AI, Software & Tech Insights by Araa Softwares";
export const DEF_D="AraaBlogs by Araa Softwares: practical articles on AI, custom software, web and mobile apps and technology for growing businesses in Qatar, Sri Lanka and beyond.";
export const body=t=>(t||"").split("\n\n#")[0].trim();
export const tags=t=>(t||"").match(/#\w+/g)?.filter((x,i,a)=>a.indexOf(x)===i)||[];
export const cut=(s,n)=>s.length>n?s.slice(0,n-1).trim()+"…":s;
export const plain=t=>body(t).replace(/\n+/g," ").replace(/^[^\p{L}\p{N}]+/u,"");
export const title=p=>cut(plain(p.text).split(/(?<=[\p{L}\d]{4,}[.!?])\s/u)[0],90)||"Untitled post";
export const excerpt=p=>cut(plain(p.text),150);
export const mins=p=>Math.max(1,Math.round(plain(p.text).split(/\s+/).length/200));
export const img=p=>/^https:\/\//.test(p.imageUrl||"")?p.imageUrl:"";
const abs=(site,u)=>/^https?:/.test(u)?u:site+u;

export const org=site=>({"@type":"Organization","@id":site+"/#org",name:ORG_NAME,url:"https://araasoftwares.com",logo:{"@type":"ImageObject",url:site+"/logo.png"},email:"araasoftwares@gmail.com",sameAs:["https://araasoftwares.com"],
  address:{"@type":"PostalAddress",streetAddress:"Madurankuli",addressLocality:"Puttalam",addressCountry:"LK"},areaServed:["LK","QA"]});
export const crumbs=(site,items)=>({"@type":"BreadcrumbList",itemListElement:items.map(([n,u],i)=>({"@type":"ListItem",position:i+1,name:n,item:site+u}))});
export const homeLd=site=>[
  {"@type":"WebSite","@id":site+"/#site",name:BRAND,url:site+"/",description:DEF_D,inLanguage:"en",publisher:{"@id":site+"/#org"},
   potentialAction:{"@type":"SearchAction",target:{"@type":"EntryPoint",urlTemplate:site+"/blogs?q={search_term_string}"},"query-input":"required name=search_term_string"}},
  {"@type":"Blog","@id":site+"/#blog",name:BRAND,url:site+"/blogs",publisher:{"@id":site+"/#org"},inLanguage:"en"}];
export const listLd=(site,posts)=>[{"@type":"CollectionPage","@id":site+"/blogs#page",name:BRAND+" articles",url:site+"/blogs",isPartOf:{"@id":site+"/#site"},
  mainEntity:{"@type":"ItemList",itemListElement:posts.slice(0,20).map((p,i)=>({"@type":"ListItem",position:i+1,url:site+"/blogs/"+encodeURIComponent(p.id),name:title(p)}))}},
  crumbs(site,[["Home","/"],["Blogs","/blogs"]])];
export function postMeta(p,site){
  const t=title(p),d=cut(plain(p.text),158)||DEF_D,path="/blogs/"+encodeURIComponent(p.id),image=abs(site,img(p)||"/logo.png"),
    iso=p.createdAt?new Date(p.createdAt).toISOString():"",kw=tags(p.text).map(x=>x.slice(1)),person=!!p.author?.email;
  return {t:cut(t,52),d,path,image,type:"article",pub:iso,mod:iso,keywords:kw,author:person?p.author.name:"",
   ld:[{"@type":"BlogPosting","@id":site+path+"#post",mainEntityOfPage:{"@type":"WebPage","@id":site+path},headline:cut(t,110),description:d,image:[image],datePublished:iso,dateModified:iso,
     keywords:kw.join(", "),wordCount:plain(p.text).split(/\s+/).length,timeRequired:`PT${mins(p)}M`,inLanguage:"en",isAccessibleForFree:true,articleSection:"Technology",
     author:person?{"@type":"Person",name:p.author.name}:{"@id":site+"/#org"},publisher:{"@id":site+"/#org"}},
    crumbs(site,[["Home","/"],["Blogs","/blogs"],[t,path]])]};
}
