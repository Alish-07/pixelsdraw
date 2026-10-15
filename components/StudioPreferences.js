"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_STUDIO_PREFERENCES, STUDIO_PREFERENCES_KEY, parseStudioPreferences, studioPreferences } from "@/lib/studio-preferences.mjs";

const PreferencesContext = createContext(null);

export function StudioPreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(DEFAULT_STUDIO_PREFERENCES);
  const current = useRef(DEFAULT_STUDIO_PREFERENCES);

  useEffect(() => {
    const restore = () => {
      try {
        const next = parseStudioPreferences(localStorage.getItem(STUDIO_PREFERENCES_KEY));
        current.current = next;
        setPreferences(next);
      } catch { /* Preferences remain usable without browser storage. */ }
    };
    const timer = window.setTimeout(restore, 0);
    const sync = event => { if (event.key === STUDIO_PREFERENCES_KEY || event.key === null) restore(); };
    window.addEventListener("storage", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", sync); };
  }, []);

  function updatePreferences(patch) {
    const next = studioPreferences({ ...current.current, ...patch });
    current.current = next;
    setPreferences(next);
    try { localStorage.setItem(STUDIO_PREFERENCES_KEY, JSON.stringify(next)); }
    catch { /* Changing preferences must never depend on storage permission. */ }
  }

  return <PreferencesContext.Provider value={{ ...preferences, updatePreferences }}>{children}</PreferencesContext.Provider>;
}

export function useStudioPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("Studio preferences require StudioPreferencesProvider.");
  return value;
}

export function LogoAnimationSetting() {
  const { animateLogo, updatePreferences } = useStudioPreferences();
  return <label className="help-setting"><input type="checkbox" checked={animateLogo}
    onChange={event => updatePreferences({ animateLogo: event.target.checked })} /> Animate website logo</label>;
}
