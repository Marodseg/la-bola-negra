-- Una pregunta por día (hora peninsular). `number` es el número de sesión: 1, 2, 3...
CREATE TABLE questions (
  day        TEXT    PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  number     INTEGER NOT NULL UNIQUE,
  text       TEXT    NOT NULL,
  category   TEXT,
  source     TEXT    NOT NULL CHECK (source IN ('editorial', 'banco', 'ia', 'reciclada')),
  created_at INTEGER NOT NULL
);

-- Un voto por votante y día. No se guarda ningún dato personal:
--   voter   = HMAC del identificador aleatorio del navegador
--   ip_hash = HMAC de (día + IP), cambia cada día y no permite seguir a nadie
CREATE TABLE votes (
  day        TEXT    NOT NULL REFERENCES questions(day),
  voter      TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  ball       TEXT    NOT NULL CHECK (ball IN ('blanca', 'negra')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, voter)
);
CREATE INDEX votes_day_ip ON votes(day, ip_hash);

-- Recuento acumulado, mantenido por trigger en la misma transacción que el voto.
CREATE TABLE tallies (
  day    TEXT    PRIMARY KEY REFERENCES questions(day),
  blanca INTEGER NOT NULL DEFAULT 0,
  negra  INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER votes_tally AFTER INSERT ON votes
BEGIN
  INSERT INTO tallies (day, blanca, negra)
  VALUES (NEW.day, NEW.ball = 'blanca', NEW.ball = 'negra')
  ON CONFLICT (day) DO UPDATE SET
    blanca = blanca + (NEW.ball = 'blanca'),
    negra  = negra  + (NEW.ball = 'negra');
END;
