import DOMPurify from "dompurify";
import { useCallback } from "react";

export const useSanitize = () => {
  return useCallback((markup: string) => {
    return DOMPurify.sanitize(markup);
  }, []);
};
