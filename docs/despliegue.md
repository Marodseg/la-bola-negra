# Despliegue

La Bola Negra tiene dos piezas, y las dos se pueden alojar gratis:

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Web (`web/`) | GitHub Pages | Páginas estáticas: portada, histórico y privacidad |
| API (`worker/`) | Cloudflare Workers + D1 + Workers AI | Votos, recuentos, preguntas diarias e histórico |

GitHub Pages solo sirve ficheros estáticos, así que los votos necesitan un servidor aparte. Cloudflare Workers da 100.000 peticiones al día, una base de datos D1 de 5 GB y un modelo de IA, todo en su plan gratuito.

Una vez configurado, cada `git push` a `main` despliega solo lo que haya cambiado.

---

## 1. Cuenta de Cloudflare y base de datos

1. Crea una cuenta gratuita en [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. En tu ordenador, dentro del proyecto:

   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create la-bola-negra
   ```

3. Apunta el `database_id` que imprime el último comando.
4. Apunta también tu **Account ID**: aparece en la barra lateral del panel de Cloudflare, en *Workers & Pages*.

## 2. Token de API de Cloudflare

En [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → plantilla **Edit Cloudflare Workers**. Añade también el permiso **Account · D1 · Edit**. Guarda el token: solo se muestra una vez.

## 3. Secretos en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.

| Secreto | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | El token del paso 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Tu Account ID |
| `D1_DATABASE_ID` | El `database_id` del paso 1 |
| `HASH_SECRET` | Un texto largo y aleatorio, por ejemplo la salida de `openssl rand -hex 32`. **No lo cambies después**: si cambia, nadie puede comprobar si ya votó hoy |

## 4. Desplegar la API

En la pestaña **Actions** → **Desplegar API (Cloudflare Workers)** → **Run workflow**.

El flujo aplica las migraciones de la base de datos, publica el Worker y sube los secretos. Al terminar, la API queda en:

```
https://la-bola-negra-api.<tu-subdominio>.workers.dev
```

(el subdominio aparece en el registro del paso «Desplegar» y en el panel de Cloudflare). Compruébalo abriendo `…/api/salud`: tiene que responder `{"ok":true}`.

## 5. Publicar la web en GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:

   | Variable | Valor |
   | --- | --- |
   | `API_URL` | La URL del Worker del paso 4, sin barra final |
   | `SITE_URL` | `https://marodseg.github.io/la-bola-negra` |

3. **Actions → Desplegar web (GitHub Pages) → Run workflow**.

La web queda en `https://marodseg.github.io/la-bola-negra/`.

## 6. Protección anti-bots (opcional, recomendado)

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) comprueba que quien vota no es un programa, sin cookies y casi siempre sin que la persona note nada.

1. Panel de Cloudflare → **Turnstile → Add widget**. Dominio: `marodseg.github.io`. Modo: *Managed*.
2. Variable del repositorio `TURNSTILE_SITE_KEY` = la *site key* (es pública).
3. Secreto del repositorio `TURNSTILE_SECRET` = la *secret key*.
4. Vuelve a ejecutar **Desplegar API**.

Desde ese momento la API exige el token de Turnstile en cada voto.

## 7. Dominio propio (opcional)

Si sirves la web desde otro dominio (por ejemplo `labolanegra.es`), añade su origen a la variable `ALLOWED_ORIGINS`, separado por comas:

```
https://labolanegra.es,https://marodseg.github.io
```

y actualiza `SITE_URL`. Vuelve a desplegar API y web.

## 8. Histórico en el repositorio

El flujo **Guardar histórico** se ejecuta cada noche, descarga todas las actas de la API y las guarda en `historico/historico.csv` y `historico/historico.json`. Así queda una copia pública y versionada aunque algún día desapareciera la base de datos. Solo necesita la variable `API_URL`.

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

**Ver los registros del Worker en directo.**

```bash
npx wrangler tail --config worker/wrangler.toml
```
