-- Invitaciones para que cada quien ponga su propia contraseña.
-- Antes, dar de alta a alguien obligaba a inventarle una contraseña y
-- mandársela por WhatsApp. Eso significa que alguien más la conoció y que
-- normalmente nunca se cambia. Ahora la cuenta nace sin contraseña y con un
-- enlace de un solo uso: quien lo abre elige la suya y nadie más la ve.
-- Sirve igual para entregar una instalación ya configurada: se prepara todo,
-- se invita al correo del cliente y él es quien la estrena.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activacion_hash  TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activacion_vence TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_usuarios_activacion ON usuarios (activacion_hash)
  WHERE activacion_hash IS NOT NULL;
