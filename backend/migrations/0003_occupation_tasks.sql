-- Tareas asíncronas de ReAPI. Una fila por ocupación: la generación de muse
-- puede tardar minutos, así que una petición nueva reanuda la tarea en curso
-- en lugar de enviar otra (y cobrar otra imagen). `attempts` nunca pasa de 2:
-- un envío inicial y un único reintento.

CREATE TABLE IF NOT EXISTS occupation_tasks (
  occupation_key TEXT PRIMARY KEY,
  occupation TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  submitted_at INTEGER NOT NULL
);
