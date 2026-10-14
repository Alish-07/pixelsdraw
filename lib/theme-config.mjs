export const THEME_KEY = "pixel-art-studio:website-theme";
export const isThemePreference = value => ["light", "dark", "system"].includes(value);

// Apply the saved appearance before hydration, without waiting for React.
export const THEME_BOOTSTRAP = `(function(){var p="system";try{p=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";}catch(e){}var dark=p==="dark"||(p!=="light"&&p!=="dark"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=dark?"dark":"light";})();`;
