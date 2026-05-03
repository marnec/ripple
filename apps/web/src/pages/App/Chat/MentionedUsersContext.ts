import { createContext, useContext } from "react";
import type { MentionedUser, MentionedTask, MentionedProject, MentionedResource } from "@ripple/shared/types/channel";

export const MentionedUsersContext = createContext<Record<string, MentionedUser>>({});
export const MentionedTasksContext = createContext<Record<string, MentionedTask>>({});
export const MentionedProjectsContext = createContext<Record<string, MentionedProject>>({});
export const MentionedResourcesContext = createContext<Record<string, MentionedResource>>({});

export function useMentionedUsers() {
  return useContext(MentionedUsersContext);
}

export function useMentionedTasks() {
  return useContext(MentionedTasksContext);
}

export function useMentionedProjects() {
  return useContext(MentionedProjectsContext);
}

export function useMentionedResources() {
  return useContext(MentionedResourcesContext);
}
