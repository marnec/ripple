import React from "react";
import { Doc } from "../../../convex/_generated/dataModel";

export const UserContext = React.createContext<Doc<"users"> | null | undefined>(null);
