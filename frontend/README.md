# Lion Finance — frontend

React 19 + TypeScript + Vite. See the [main README](../README.md) for setup.

```powershell
npm install
Copy-Item .env.example .env   # VITE_API_BASE_URL=/api (Vite proxies it to the backend on :3001)
npm run dev                   # http://localhost:5173
npm run lint
npm run build
```

- All data comes from the backend API through `src/api/client.ts` (session cookie,
  CSRF header, 15 s timeout, typed errors). There is no demo/mock data mode.
- The UI hides screens a user lacks permission for, but the backend enforces every
  permission independently.
