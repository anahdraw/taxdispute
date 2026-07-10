"use client";

import { useEffect, useState, type ReactNode } from "react";

const THEME_MODE_KEY = "tax-dispute-theme-mode";

type ThemeMode = "dark" | "light";

function storedTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_MODE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function DetailThemeShell({ children, className }: { children: ReactNode; className: string }) {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    setTheme(storedTheme());

    function syncTheme(event: StorageEvent) {
      if (event.key === THEME_MODE_KEY) setTheme(event.newValue === "light" ? "light" : "dark");
    }

    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  return <main className={`${className} theme-${theme}`}>{children}</main>;
}
