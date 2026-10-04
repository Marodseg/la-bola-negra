/** Minúsculas y sin tildes, para buscar sin preocuparse de cómo se escribe. */
export const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
