import { create } from "zustand";
import type { CustomColors } from "../../electron/types";

interface ConfigState {
  theme: "dark" | "light";
  customColors: CustomColors;
  setTheme: (theme: "dark" | "light") => void;
  setCustomColors: (colors: CustomColors) => void;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  theme: "dark",
  customColors: {},
  setTheme: (theme) => set({ theme }),
  setCustomColors: (customColors) => set({ customColors }),
  fetchConfig: async () => {
    const config = await window.ipcRenderer.invoke("get-global-config");
    if (config) {
      set({ theme: config.theme, customColors: config.customColors || {} });
      if (config.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  },
}));
