# SpamKill local

Aplicación web local para revisar publicidad, newsletters y notificaciones de
Gmail y Outlook por separado. Permite analizar remitentes, abrir sus mensajes,
desuscribirse y mover correos seleccionados a la papelera.

## Requisitos

- Node.js 22.13 o posterior
- Una aplicación OAuth de Google para Gmail
- Una aplicación OAuth de Microsoft Entra para Outlook
- Cloudflare Tunnel solo si quieres acceder desde un dominio público

## Instalación

```powershell
npm install
```

Crea `.env.local` con:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OUTLOOK_CLIENT_ID=...
OUTLOOK_CLIENT_SECRET=...
APP_ENCRYPTION_KEY=...
```

## Base local

Después del primer build, aplica las migraciones D1 locales:

```powershell
npm run build
npm run db:migrate:local
```

La base se guarda en `.wrangler/state` y no se sube al repositorio.

## Ejecutar desde VS Code

```powershell
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Para usar el dominio mediante Cloudflare Tunnel, en otra terminal ejecuta:

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run colesterol-game
```

La configuración existente dirige `juego.luiszamora.dev` al Apache de XAMPP y
`spamkill.luiszamora.dev` a `localhost:3000`.

## OAuth con el túnel

Registra estos callbacks en cada proveedor:

- Google: `https://spamkill.luiszamora.dev/api/google/callback`
- Microsoft Entra: `https://spamkill.luiszamora.dev/api/outlook/callback`

## Comandos útiles

```powershell
npm run lint
npm run build
npm run start
```
