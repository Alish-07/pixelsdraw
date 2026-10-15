"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const AuthContext = createContext({ client: null, user: null, ready: false });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [client] = useState(getSupabase);
  const [session, setSession] = useState({ user: null, ready: false });
  useEffect(() => {
    let active = true;
    let changed = false;
    if (!client) {
      const timer = setTimeout(() => setSession({ user: null, ready: true }), 0);
      return () => clearTimeout(timer);
    }
    client.auth.getSession().then(({ data }) => {
      if (active && !changed) setSession({ user: data.session?.user || null, ready: true });
    }).catch(() => { if (active && !changed) setSession({ user: null, ready: true }); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, value) => {
      changed = true;
      if (active) setSession({ user: value?.user || null, ready: true });
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client]);
  return <AuthContext.Provider value={{ client, ...session }}>{children}</AuthContext.Provider>;
}
