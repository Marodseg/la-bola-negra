# ⚫ La Bola Negra

Una pregunta al día para toda España. Cada persona echa **una bola** en la urna:

- ⚪ **Bola blanca**: sí
- ⚫ **Bola negra**: no

La urna es de cristal esmerilado mientras no hayas votado, así que nadie puede dejarse influir. Al echar tu bola, el cristal se aclara y las bolas del resto de España caen dentro con física real. Puedes ver la tuya marcada con un aro dorado.

## Cómo funciona

- **Una pregunta por día**, que cambia a medianoche (hora peninsular, `Europe/Madrid`).
- **Un voto por persona y pregunta.** El voto se ata a una cookie firmada y a un identificador del dispositivo, y además hay un tope de votos por IP y día (`BN_MAX_VOTOS_POR_IP`, 25 por defecto, pensado para casas y oficinas que comparten conexión). No hace falta registrarse.
- **Resultados ocultos hasta votar.** La API no los devuelve hasta que has votado.
- **Archivo** con los resultados de los días anteriores.
- Bolas que se pueden **arrastrar** hasta la urna o **tocar dos veces**, con sonido sintetizado de choque entre bolas y vibración en móvil.

## Tecnología

- **Node.js 22.13 o superior** + Express. Los votos se guardan en SQLite con el módulo `node:sqlite` que trae Node, así que no hay dependencias nativas.
- Frontend sin framework: HTML, CSS y JS. La física de las bolas va con [matter.js](https://brm.io/matter-js/) y se dibuja en un `<canvas>`.

## Arrancar en local

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # recarga al cambiar el código
npm test
```

## Preguntas

Están en [`questions.json`](questions.json):

```json
{
  "start": "2026-10-04",
  "fixed": { "2026-12-31": { "text": "¿Ha sido 2026 un buen año para España?", "tag": "Fin de año" } },
  "pool": [{ "text": "¿Tortilla de patatas con cebolla?", "tag": "Gastronomía" }]
}
```

- `start`: día de la pregunta nº 1.
- `fixed`: preguntas fijadas a una fecha concreta.
- `pool`: el resto, en orden, una por día. Cuando se acaban, vuelven a empezar.

Formula las preguntas para que se respondan con sí o no. Ojo: si cambias el orden de `pool` después de lanzar la web, cambian las preguntas de los días anteriores en el archivo. Las nuevas, mejor añadirlas al final.

## Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP |
| `BN_DATA_DIR` | `./data` | Dónde se guardan la base de datos y el secreto |
| `BN_SECRET` | se genera solo | Secreto para firmar las cookies de los votantes |
| `BN_MAX_VOTOS_POR_IP` | `25` | Votos máximos por IP y día |
| `BN_QUESTIONS` | `./questions.json` | Archivo de preguntas |
| `TRUST_PROXY` | (sin valor) | Ponlo a `1` si hay un proxy delante (Render, Fly, nginx...) para leer la IP real |

## Desplegar

Con Docker:

```bash
docker build -t la-bola-negra .
docker run -p 3000:3000 -v bola-datos:/data -e TRUST_PROXY=1 la-bola-negra
```

Sirve cualquier hosting que ejecute Node o Docker y tenga **disco persistente** para `/data` (Railway, Fly.io, Render con disco, un VPS...).

---

Hecho por **Marodseg**, Manuel Ángel Rodríguez Segura.
