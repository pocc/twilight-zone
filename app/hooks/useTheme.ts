import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '../lib/constants';

export function useTheme() {
  // Default to dark mode when the user has no saved preference; once they
  // explicitly choose, that choice is remembered (persisted in the effect
  // below). Only an explicit 'light' opts out of dark.
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.theme) !== 'light';
  });

  // Twilight is retained across visits as one of the three view modes
  // (twilight / base-light / base-dark). Restore it from storage so a reload
  // returns the user to whatever they last used: if they were in twilight we
  // re-enter twilight directly (no intro replay); otherwise base mode honours
  // the persisted light/dark choice above. The effect below keeps the
  // 'on'/'off' value current.
  const [isTwilight, setIsTwilight] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.twilightTheme) === 'on';
  });

  useEffect(() => {
    document.body.classList.toggle('light-theme', !isDark && !isTwilight);
    document.body.classList.toggle('twilight-theme', isTwilight);
    localStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEYS.twilightTheme, isTwilight ? 'on' : 'off');
  }, [isDark, isTwilight]);

  const toggle = useCallback(() => setIsDark(d => !d), []);
  const toggleTwilight = useCallback(() => setIsTwilight(t => !t), []);
  // Force base-dark mode directly (used by the title click to normalize the
  // view from light base mode). Twilight exit is handled separately in Layout
  // so it can play the CRT power-off transition.
  const goDark = useCallback(() => setIsDark(true), []);

  return { isDark, toggle, isTwilight, toggleTwilight, goDark };
}
