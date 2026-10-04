# Histórico de La Bola Negra

Copia pública de todas las actas, que el flujo [Guardar histórico](../.github/workflows/historico.yml) actualiza cada noche desde la API.

- `historico.csv`: una fila por sesión (número, fecha, pregunta, categoría, origen, bolas blancas, bolas negras, total y resultado). Se abre bien en Excel.
- `historico.json`: los mismos datos en JSON.

El campo `origen` indica de dónde salió la pregunta: `editorial` (fijada para esa fecha), `banco` (escrita a mano), `ia` (propuesta por el modelo y filtrada) o `reciclada`.
