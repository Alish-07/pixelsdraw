"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { THEME_KEY, isThemePreference as isPreference } from "@/lib/theme-config.mjs";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("light");
  const [preference, setPreferenceState] = useState("system");
  const preferenceRef = useRef("system");

  function applyPreference(value) {
    const selected = isPreference(value) ? value : "system";
    const resolved = selected === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : selected;
    preferenceRef.current = selected;
    document.documentElement.dataset.theme = resolved;
    setPreferenceState(selected);
    setTheme(resolved);
  }

  function setPreference(value) {
    applyPreference(value);
    try { localStorage.setItem(THEME_KEY, value); } catch { /* The switch still works if browser storage is disabled. */ }
  }

  useEffect(() => {
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch { /* Use the device preference. */ }
    // Restore browser appearance after hydration; the server cannot read localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyPreference(saved);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followDevice = () => { if (preferenceRef.current === "system") applyPreference("system"); };
    const followOtherTab = (event) => { if (event.key === THEME_KEY) applyPreference(event.newValue); };
    media.addEventListener("change", followDevice);
    window.addEventListener("storage", followOtherTab);
    return () => { media.removeEventListener("change", followDevice); window.removeEventListener("storage", followOtherTab); };
  }, []);

  return <ThemeContext.Provider value={{ theme, preference, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Theme controls must be inside ThemeProvider.");
  return context;
}

export function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  return <button type="button" className="website-theme-toggle" aria-label="Toggle website dark mode" aria-pressed={theme === "dark"}
    title={theme === "dark" ? "Switch website to light mode" : "Switch website to dark mode"}
    onClick={() => setPreference(theme === "dark" ? "light" : "dark")}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span></button>;
}
