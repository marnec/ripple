import { createContext, useContext } from "react";
import { MentionedUser, MentionedTask, MentionedProject } from "@shared/types/channel";

export const MentionedUsersContext = createContext<Record<string, MentionedUser>>({});
export const MentionedTasksContext = createContext<Record<string, MentionedTask>>({});
export const MentionedProjectsContext = createContext<Record<string, MentionedProject>>({});

export function useMentionedUsers() {
  return useContext(MentionedUsersContext);
}

export function useMentionedTasks() {
  return useContext(MentionedTasksContext);
}

export function useMentionedProjects() {
  return useContext(MentionedProjectsContext);
}
