import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { PostsProvider } from "./context/PostsContext";
import "./index.css";

// VITE_ROUTER=hash keeps the original #/route URLs (no server fallback needed).
const Router = import.meta.env.VITE_ROUTER === "hash" ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <PostsProvider>
            <App />
          </PostsProvider>
        </AuthProvider>
      </ThemeProvider>
    </Router>
  </React.StrictMode>,
);
