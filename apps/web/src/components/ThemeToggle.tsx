"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup size="sm" onValueChange={(values) => { const last = values[values.length - 1]; if (last) setTheme(last); }} value={theme ? [theme] : []}>
      <ToggleGroupItem value="light" aria-label="Light">
        <SunIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark">
        <MoonIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System">
        <MonitorIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
