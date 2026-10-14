"use client";

import { useEffect, useState } from "react";
import { fieldSuggestion } from "@/lib/competition-rules.mjs";

export default function SuggestedField({ name, label, kind, maxLength, autoComplete = "off" }) {
  const [suggestion, setSuggestion] = useState("");
  const [value, setValue] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSuggestion(fieldSuggestion(kind)), 0); return () => clearTimeout(timer); }, [kind]);
  return <div className="suggested-field"><label>{label}<input name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder={suggestion || `Choose ${label.toLowerCase()}`} maxLength={maxLength} autoComplete={autoComplete} /></label>
    <small>Leave blank to use {suggestion || "our suggestion"}.</small>
    <input type="hidden" name={`${name}Suggestion`} value={suggestion} /><input type="hidden" name={`${name}Auto`} value={!value.trim() ? "true" : "false"} />
  </div>;
}
