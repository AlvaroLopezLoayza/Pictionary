# Garabato Party

Juego para eventos en vivo con pantalla Host, panel Admin y hasta 100 jugadores móviles. Un único proceso Node sirve React y mantiene el estado autoritativo por Socket.io.

## Desarrollo

Requisitos: Node.js 22 o superior.

```bash
cp .env.example .env
npm install
npm run dev
```

En Windows puedes copiar `.env.example` como `.env` desde el Explorador. Abre `http://localhost:3000/admin`, entra con `ADMIN_CODE`, asigna equipos y usa los enlaces/QR generados por el panel.

Comandos disponibles:

- `npm run dev`: servidor con recarga automática y Vite integrado.
- `npm run check`: tipos, pruebas y build de producción.
- `npm start`: ejecuta el build de producción.
- `npm run test:smoke`: valida auth, registro y privacidad contra el servidor local activo.
- `npm run test:load`: conecta 100 espectadores; usa el servidor local por defecto o `LOAD_URL` y `LOAD_EVENT_TOKEN` para staging.

## Variables

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP; por defecto `3000`. |
| `APP_ORIGIN` | Origen HTTPS público exacto, sin `/` final. |
| `ADMIN_CODE` | Código de administrador de 8 o más caracteres. |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
| `DATA_DIR` | Directorio persistente; por defecto `./data`. |

## Banco de palabras

El panel permite alta, edición, eliminación e importación CSV transaccional. El archivo debe estar en UTF-8 y tener estas cabeceras:

```csv
word,difficulty,aliases,enabled
café,easy,cafetería|taza de café,true
trabajo en equipo,hard,colaboración,true
```

Si una fila es inválida o una palabra ya existe, no se importa ninguna fila.

## Despliegue

### Render

`render.yaml` crea gratuitamente el servicio Docker y su healthcheck. En **New → Blueprint**, conecta este repositorio y configura `APP_ORIGIN` con el dominio público exacto y `ADMIN_CODE` con un valor secreto. `SESSION_SECRET` se genera automáticamente.

Render Free no admite discos persistentes: los snapshots funcionan mientras la instancia siga activa, pero se pierden al reiniciar, redesplegar o suspender el servicio. Evita desplegar cambios durante una partida.

### Railway

1. Crea un servicio desde el repositorio; Railway detectará el `Dockerfile` raíz.
2. Añade un volumen montado en `/app/data` y genera un dominio público.
3. Configura `NODE_ENV=production`, `DATA_DIR=/app/data`, `APP_ORIGIN`, `ADMIN_CODE` y un `SESSION_SECRET` aleatorio.
4. Mantén exactamente una réplica: el snapshot JSON y los temporizadores pertenecen a una sola instancia.

La aplicación restaura una ronda interrumpida en pausa. El administrador debe reconectar al dibujante y pulsar **Reanudar**.
