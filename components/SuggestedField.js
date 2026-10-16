"use client";

import { useEffect, useState } from "react";
import { fieldInputState, fieldSuggestion } from "@/lib/competition-rules.mjs";

export default function SuggestedField({ name, label, kind, maxLength, autoComplete = "off", preferredName = "" }) {
  const [suggestion, setSuggestion] = useState("");
  // null means untouched: a profile loaded after mount can still fill the field.
  const [editedValue, setValue] = useState(null);
  useEffect(() => { const timer = setTimeout(() => setSuggestion(fieldSuggestion(kind)), 0); return () => clearTimeout(timer); }, [kind]);
  const { value, fallback, automatic } = fieldInputState(preferredName, suggestion, editedValue);
  return <div className="suggested-field"><label>{label}<input name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder={fallback || `Choose ${label.toLowerCase()}`} maxLength={maxLength} autoComplete={autoComplete} /></label>
    {!preferredName && <small>Leave blank to use {fallback || "our suggestion"}.</small>}
    <input type="hidden" name={`${name}Suggestion`} value={fallback} /><input type="hidden" name={`${name}Auto`} value={automatic ? "true" : "false"} />
  </div>;
}
