import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

let auth = null;

export const getAuthInstance = () => auth;

/**
 * Initialises Firebase once. Uses VITE_FIREBASE_* values when present,
 * otherwise the apiKey served by the backend at /auth-config (same as the original app).
 * Returns the Auth instance, or null when Firebase is not configured.
 */
export function initFirebase(server = {}) {
  if (auth) return auth;
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY || server.apiKey;
  if (!apiKey) return null;
  const app = initializeApp({
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || server.authDomain,
    projectId: env.VITE_FIREBASE_PROJECT_ID || server.projectId,
    appId: env.VITE_FIREBASE_APP_ID || server.appId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  });
  auth = getAuth(app);
  return auth;
}
