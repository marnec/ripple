import { useCreateBlockNote } from "@blocknote/react";
import { useMemo } from "react";

export const useCreateMessageRenderer = () => {
  return useMemo(() => {
    return useCreateBlockNote();
  }, []);
};
