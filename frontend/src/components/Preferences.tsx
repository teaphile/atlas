import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_PREFS, readPreferences, parsePreferences } from "../workspace";
import type { Preferences } from "../workspace";
const Ctx = createContext({
  preferences: DEFAULT_PREFS,
  setPreferences: (_p: Preferences) => {},
});
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    try {
      localStorage.setItem("atlas.preferences.v2", JSON.stringify(preferences));
    } catch {
      /* nonpersistent mode */
    }
    document.documentElement.dataset.motion = preferences.motion;
    document.documentElement.dataset.density = preferences.density;
  }, [preferences]);
  return (
    <Ctx.Provider
      value={{
        preferences,
        setPreferences: (p) => setPreferences(parsePreferences(p)),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
export const usePreferences = () => useContext(Ctx);
export function PreferenceControls() {
  const { preferences, setPreferences } = usePreferences();
  return (
    <div className="preference-controls">
      <label>
        Signal Lab & comparison units
        <select
          aria-label="Signal Lab and comparison units"
          value={preferences.units}
          onChange={(e) =>
            setPreferences({
              ...preferences,
              units: e.target.value as Preferences["units"],
            })
          }
        >
          <option value="metric">Metric · °C / km/h / mm</option>
          <option value="imperial">US display · °F / mph / in</option>
        </select>
      </label>
      <label>
        Motion
        <select
          aria-label="Motion"
          value={preferences.motion}
          onChange={(e) =>
            setPreferences({
              ...preferences,
              motion: e.target.value as Preferences["motion"],
            })
          }
        >
          <option value="system">Follow device preference</option>
          <option value="reduce">Reduced motion</option>
        </select>
      </label>
      <label>
        Density
        <select
          aria-label="Density"
          value={preferences.density}
          onChange={(e) =>
            setPreferences({
              ...preferences,
              density: e.target.value as Preferences["density"],
            })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <p className="muted small">
        Exports and scientific inputs stay in canonical SI units. Other panels
        show their units explicitly. Preferences contain no access keys.
      </p>
    </div>
  );
}
