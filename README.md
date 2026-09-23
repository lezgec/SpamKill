# SpamKill local

Aplicación web local para revisar publicidad, newsletters y notificaciones de
Gmail y Outlook por separado. La persistencia usa MySQL/MariaDB de XAMPP y
consultas SQL directas; no usa D1, Drizzle ni una base de datos en la nube.

## Requisitos

- Node.js 22.13 o posterior.
- XAMPP con MySQL/MariaDB iniciado en el puerto 3306.
- Credenciales OAuth de Google y Microsoft Entra.
- Cloudflare Tunnel solo si quieres acceder desde `spamkill.luiszamora.dev`.

## Configuración

Instala las dependencias:

```powershell
npm install
```

Completa `.env.local` con tus credenciales OAuth y estos valores de MySQL:

Puedes partir de la plantilla `.env.example`:

```powershell
Copy-Item .env.example .env.local
```

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=spamkill
```

Inicializa la base nueva y sus tablas:

```powershell
npm run db:init
```

El script ejecuta [db/schema.sql](/C:/Users/lezgo/Documents/SpamKill/db/schema.sql)
y deja la base vacía para empezar desde cero.

## Ejecutar desde VS Code

```powershell
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Para una compilación de
producción local:

```powershell
npm run build
npm run start
```

## Cloudflare Tunnel opcional

La configuración existente puede dirigir `spamkill.luiszamora.dev` a
`localhost:3000`:

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run colesterol-game
```

Registra estos callbacks OAuth:

- Google: `https://spamkill.luiszamora.dev/api/google/callback`
- Microsoft Entra: `https://spamkill.luiszamora.dev/api/outlook/callback`

URLs públicas para la información de OAuth:

- Términos del servicio: `https://spamkill.luiszamora.dev/terms`
- Declaración de privacidad: `https://spamkill.luiszamora.dev/privacy`

## Preparar el repositorio para compartirlo

No subas `.env.local`, respaldos SQL, carpetas de datos de XAMPP ni tokens OAuth.
El archivo `.env.example` contiene únicamente nombres de variables y valores de
ejemplo. Los respaldos locales se excluyen mediante `.gitignore`.

Antes de abrir un pull request o publicar el repositorio:

```powershell
npm ci
npm run lint
npm run build
```

## Comandos útiles

```powershell
npm run lint
npm run db:init
```
