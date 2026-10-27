import { useEffect } from "react";

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · AraaPosts` : "AraaPosts";
  }, [title]);
}
