# Seguridad

## Cómo avisar de un fallo

Si encuentras una vulnerabilidad, **no abras una issue pública**. Usa el aviso privado de GitHub:
pestaña **Security → Report a vulnerability** de este repositorio. Intentaré responder en menos de una semana.

## Medidas aplicadas

- **Sin datos personales.** No hay cuentas ni cookies. El identificador del navegador y la IP solo se guardan como HMAC-SHA256 con un secreto del servidor; la huella de la IP incluye la fecha, así que cambia cada día.
- **Un voto por persona y día.** Tres barreras en la base de datos:
  1. Clave única `(día, votante)`: el identificador aleatorio del navegador. Frena las pestañas repetidas.
  2. Clave única `(día, dispositivo)`: HMAC de la fecha, la IP y una huella técnica del navegador (navegador, pantalla, idioma, zona horaria y gráfica). Frena el modo incógnito y el borrado de datos en el mismo dispositivo y la misma red.
  3. Tope de votos por conexión y día (5 por defecto).

  Además, [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) frena a los programas automáticos.
- **CORS y origen.** La API solo responde con cabeceras CORS a los orígenes de `ALLOWED_ORIGINS` y rechaza votos que no vengan de ellos.
- **Entradas validadas.** Cuerpos JSON de 2 KB como máximo, valores cerrados (`blanca` / `negra`), fechas y UUID comprobados, consultas SQL siempre parametrizadas.
- **Cabeceras.** La API envía `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Strict-Transport-Security`. La web lleva una CSP estricta (sin scripts ni estilos en línea, sin terceros salvo Turnstile).
- **Sin `innerHTML`.** Todo el texto que llega de la API se inserta como texto.
- **CSV seguro.** El histórico en CSV neutraliza celdas que Excel podría interpretar como fórmulas.
- **IA con filtros.** Las preguntas que propone la IA pasan una validación (formato, longitud, temas vetados, parecido con preguntas anteriores) antes de publicarse; si no la pasan, se usa el banco escrito a mano.
- **Secretos fuera del código.** `HASH_SECRET`, `TURNSTILE_SECRET` y las credenciales de Cloudflare viven en los secretos de GitHub y de Cloudflare. El Worker se niega a funcionar si falta `HASH_SECRET`.
- **Dependencias.** Dependabot actualiza dependencias y acciones; la integración continua ejecuta `npm audit`.

## Límites conocidos

Sin registro no existe una forma perfecta de impedir el voto múltiple: alguien que cambie de navegador o de red (de la wifi a los datos del móvil, por ejemplo) puede votar alguna vez más. Las barreras anteriores lo hacen incómodo y limitado, pero no imposible. Al revés, dos dispositivos idénticos (mismo modelo, sistema e idioma) en la misma wifi cuentan como uno, y solo vota el primero. Por eso la web avisa de que no es una encuesta científica.
