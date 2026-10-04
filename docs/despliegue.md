# Despliegue

La Bola Negra tiene dos piezas, y las dos se pueden alojar gratis:

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Web (`web/`) | GitHub Pages | Páginas estáticas: portada, histórico y privacidad |
| API (`worker/`) | Cloudflare Workers + D1 + Workers AI | Votos, recuentos, preguntas diarias e histórico |

GitHub Pages solo sirve ficheros estáticos, así que los votos necesitan un servidor aparte. Cloudflare Workers da 100.000 peticiones al día, una base de datos D1 de 5 GB y un modelo de IA, todo en su plan gratuito.

Una vez configurado, cada `git push` a `main` despliega solo lo que haya cambiado.

---

## 1. Base de datos

La base de datos D1 `la-bola-negra` ya está creada (en Europa occidental) y su identificador está en `worker/wrangler.toml`. Las tablas las crea el propio flujo de despliegue con las migraciones de `worker/migrations/`.

Si algún día quieres usar otra base de datos, créala con `npx wrangler d1 create la-bola-negra` y cambia el `database_id` (o define el secreto `D1_DATABASE_ID`).

## 2. Subdominio workers.dev

Si la cuenta de Cloudflare es nueva, entra una vez en **Workers & Pages** en el panel y acepta el subdominio `*.workers.dev` que te propone. Sin él no se puede publicar ningún Worker.

## 3. Token de API de Cloudflare

En [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → plantilla **Edit Cloudflare Workers**. Añade también los permisos **Account · D1 · Edit** y **Account · Workers AI · Read** (este último solo lo usa el flujo «Probar IA»). En *Account Resources* elige tu cuenta; deja vacíos *Client IP Address Filtering* y *TTL*. Guarda el token: solo se muestra una vez.

Tu **Account ID** aparece en la página principal de **Workers & Pages**, en la columna de la derecha.

## 4. Secretos en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.

| Secreto | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | El token del paso 3 |
| `CLOUDFLARE_ACCOUNT_ID` | Tu Account ID |
| `HASH_SECRET` | Un texto largo y aleatorio, por ejemplo la salida de `openssl rand -hex 32`. **No lo cambies después**: si cambia, nadie puede comprobar si ya votó hoy |

## 5. Activar GitHub Pages y desplegar

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Desplegar API (Cloudflare Workers) → Run workflow**.

El flujo crea las tablas, publica la API, sube los secretos y, al terminar, vuelve a publicar la web con la dirección de la API dentro. La dirección de la API se calcula sola a partir de tu subdominio de Cloudflare:

```
https://la-bola-negra-api.<tu-subdominio>.workers.dev/api/salud   →   {"ok":true}
```

La web queda en `https://marodseg.github.io/la-bola-negra/`.

Las variables `API_URL` y `SITE_URL` del repositorio son opcionales: solo hacen falta si cambias de dominio.

## 6. Protección anti-bots (recomendado)

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) comprueba que quien vota no es un programa, sin cookies y casi siempre sin que la persona note nada.

1. Panel de Cloudflare → **Turnstile → Add widget manually** (no hace falta «Spin»: la integración ya está hecha).
   - *Hostnames*: `marodseg.github.io` (sin `https://` ni ruta).
   - *Widget Mode*: **Managed**. *Pre-clearance*: **No**.
2. Variable del repositorio (pestaña *Variables*) `TURNSTILE_SITE_KEY` = la *site key* (es pública).
3. Secreto del repositorio (pestaña *Secrets*) `TURNSTILE_SECRET` = la *secret key*.
4. Vuelve a ejecutar **Desplegar API**.

Desde ese momento la API exige el token de Turnstile en cada voto. Casi nadie verá nada; si Cloudflare pide marcar la casilla, la web lo indica antes de dejar votar. Si un voto se rechaza, el aviso incluye el código de error de Cloudflare.

## 7. Dominio propio (opcional)

Si sirves la web desde otro dominio (por ejemplo `labolanegra.es`), añade su origen a la variable `ALLOWED_ORIGINS`, separado por comas:

```
https://labolanegra.es,https://marodseg.github.io
```

y actualiza `SITE_URL`. Vuelve a desplegar API y web.

## 8. Histórico en el repositorio

El flujo **Guardar histórico** se ejecuta cada noche, descarga todas las actas de la API y las guarda en `historico/historico.csv` y `historico/historico.json`. Así queda una copia pública y versionada aunque algún día desapareciera la base de datos. Usa los mismos secretos de Cloudflare para saber dónde está la API.

---

## Mantenimiento

**Fijar la pregunta de un día concreto.** Añádela a `editorial` en `worker/src/questions/banco.json`:

```json
"2026-12-31": { "text": "¿Ha sido 2026 un buen año para España?", "category": "Sociedad" }
```

La pregunta se elige la víspera, a las 20:00 UTC, así que hay que subirla antes.

**Añadir preguntas al banco.** Añádelas al final de `banco` en el mismo fichero. Se usan en orden y cada una solo una vez. Cuando se acaban, la IA propone preguntas nuevas. Si quieres que la IA las proponga siempre, pon `PREFER_AI = "true"` en `worker/wrangler.toml`.

**Consultar la base de datos.**

```bash
npx wrangler d1 execute la-bola-negra --remote --config worker/wrangler.toml \
  --command "SELECT day, number, source, text FROM questions ORDER BY day DESC LIMIT 10"
```

**Comprobar la IA.** *Actions → Probar IA → Run workflow* genera cinco preguntas con el modelo real y los mismos filtros que la API.

**Ver los registros del Worker en directo.**

```bash
npx wrangler tail --config worker/wrangler.toml
```
