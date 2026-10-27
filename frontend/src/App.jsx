import {Routes,Route,useLocation} from "react-router-dom";
import {Nav,Footer} from "./ui.jsx";
import {HomePage,BlogsPage,NewsPage,BlogPage} from "./pages.jsx";
import {Admin} from "./Subscribe.jsx";
import {AuthModal,Toast} from "./Client.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import {Link} from "react-router-dom";import {useSeo} from "./lib.js";
function NotFound(){useSeo({t:"Page not found",path:"/404",noindex:true});
  return <div className="grid justify-items-center gap-4 px-4 pt-40 text-center animate-rise"><h1 className="text-5xl">404</h1><p className="text-w/60">This page doesn't exist.</p><Link to="/blogs" className="btn pri">Browse blogs</Link></div>}
export default function App(){
  const {pathname}=useLocation();
  return <><Nav/><AuthModal/><Toast/><main key={pathname.split("/")[1]}><ErrorBoundary key={pathname}>
    <Routes><Route path="/" element={<HomePage/>}/><Route path="/blogs" element={<BlogsPage/>}/><Route path="/blogs/:id" element={<BlogPage/>}/>
    <Route path="/news" element={<NewsPage/>}/><Route path="/admin" element={<Admin/>}/><Route path="*" element={<NotFound/>}/></Routes></ErrorBoundary></main><Footer/></>;
}
