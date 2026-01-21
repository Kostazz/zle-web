/**
 * PostCSS config (CJS)
 *
 * Render/Vite někdy vypíše warning, když se config načítá přes ESM.
 * CJS varianta je nejvíc “tichá” a stabilní.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
