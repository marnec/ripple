import DOMPurify from "dompurify";

export const useSanitize = () => {
  return (markup: string) => {
    return DOMPurify.sanitize(markup);
  };
};
