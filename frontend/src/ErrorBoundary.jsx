import {Component} from "react";
export default class ErrorBoundary extends Component{
  state={e:null};
  static getDerivedStateFromError(e){return {e}}
  componentDidCatch(e){console.error(e)}
  render(){return this.state.e?<div className="grid justify-items-center gap-4 px-4 pt-40 text-center"><h1 className="text-3xl">Something went wrong</h1><p className="max-w-md text-w/60">{String(this.state.e.message||this.state.e)}</p><a href="/" className="btn pri">Back to home</a></div>:this.props.children}
}
