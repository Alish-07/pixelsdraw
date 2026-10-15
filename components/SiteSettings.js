"use client";

import { useEffect, useRef } from "react";
import { LogoAnimationSetting } from "./StudioPreferences";

// Keep animation preferences reachable on pages without a pixel editor.
export default function SiteSettings() {
  const menu = useRef(null);
  useEffect(() => {
    const close = event => {
      if (event.type === "keydown" ? event.key === "Escape" : !menu.current?.contains(event.target)) {
        if (menu.current) menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return <details className="site-settings" ref={menu}>
    <summary aria-label="Site settings" title="Site settings"><span aria-hidden="true">⚙</span></summary>
    <div className="site-settings-content"><h2>Site settings</h2><LogoAnimationSetting /><p>Reduced-motion preferences always take priority.</p></div>
  </details>;
}
