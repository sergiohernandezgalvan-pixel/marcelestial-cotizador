-- Revocación de sesiones.
-- Hasta ahora un token vivía 30 días y nada lo podía matar: cambiarle la
-- contraseña a alguien, o desactivarle la cuenta, no cerraba la sesión que ya
-- traía en el teléfono. Con este contador, cada token lleva escrita la versión
-- con la que se firmó; al subir la versión, todos los tokens viejos de esa
-- persona dejan de servir de inmediato.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
