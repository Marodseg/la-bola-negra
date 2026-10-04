// localStorage puede no estar disponible (modo privado estricto, almacenamiento bloqueado...).
export const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
  },
};
