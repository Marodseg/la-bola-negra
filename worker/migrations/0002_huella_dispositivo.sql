-- Huella del dispositivo en la misma conexión y día:
--   device_key = HMAC de (día + IP + huella técnica del navegador)
-- No cambia al usar el modo incógnito ni al borrar los datos del navegador, así que impide
-- votar otra vez desde el mismo dispositivo y la misma red. Cambia cada día y no se puede revertir.
ALTER TABLE votes ADD COLUMN device_key TEXT;
CREATE UNIQUE INDEX votes_day_device ON votes(day, device_key) WHERE device_key IS NOT NULL;
