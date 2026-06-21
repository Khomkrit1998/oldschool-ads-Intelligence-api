# Old School · Ads Intelligence

A responsive Meta Ads intelligence dashboard for the **Old School** agency, built
from the Claude Design handoff (`Ads Intelligence.dc.html`). Thai-language UI,
red/orange brand, desktop sidebar + mobile bottom-nav.

## Tech stack

- **React + Vite** (TypeScript)
- **Tailwind CSS** with brand tokens
- **shadcn/ui** primitives (`Button`, `Card`, `Badge`) on Radix + CVA
- **React Router** for navigation (incl. campaign drill-down)
- **Zustand** for cross-cutting state (selected account, date range, geo metric)
- **lucide-react** icons, **@svg-maps/thailand** for the real province choropleth

## Pages

| Route               | Page            | Highlights                                                                 |
| ------------------- | --------------- | -------------------------------------------------------------------------- |
| `/`                 | Dashboard       | All-accounts portfolio, KPI cards, spend/click trend, spend-by-campaign, AI insights, top creatives |
| `/campaigns`        | Campaigns       | Sortable-style table; tap a row to drill in                                |
| `/campaigns/:name`  | Campaign detail | Stat grid + the creatives belonging to that campaign                       |
| `/geo`              | Geo Heatmap     | Real Thailand map choropleth (fallback bubble map) + cursor hover tooltip  |
| `/token`            | Token / API     | Connection status, masked token reveal/copy, scopes, API quota, connected accounts |

The 4-account switcher (top-right) rescales every page; each account has a
distinct performance profile, exactly as in the design source.

## Develop

The repo is split into two independent apps — run each in its own terminal.

```bash
# Frontend (React + Vite)
cd frontend
cp .env.example .env      # VITE_BACKEND_URL=http://localhost:4000
pnpm install
pnpm dev                  # http://localhost:5173

# Backend (Express — Facebook OAuth proxy)
cd backend
cp .env.example .env      # fill META_APP_ID / META_APP_SECRET / COOKIE_SECRET
pnpm install
pnpm dev                  # http://localhost:4000
```

## Project layout

```
frontend/                  React + Vite dashboard
  src/
    components/            TrendChart, RangePills, ui/ (shadcn primitives)
    data/                 static dataset transcribed from the design source
    features/facebook/    Facebook login button, hooks, client service, types
    hooks/                useViewport, useThailandMap
    layout/               AppShell, Sidebar, Topbar, AccountSwitcher, MobileNav
    lib/                  compute (scaling, heatmap ramp, status), format, utils (cn)
    pages/                Dashboard, Campaigns, CampaignDetail, Geo, Token
    store.ts              Zustand store

backend/                   Express OAuth proxy — keeps META_APP_SECRET server-side
  src/
    config/env.ts         validated environment variables
    routes/               /auth/facebook/* and /api/facebook/*
    controllers/          login, callback, profile, pages, posts
    services/             Meta Graph API client, error mapping, session store
    types/                Graph API response types
```

> The dashboard's static cards are demo data faithful to the prototype. The
> **Token** page additionally talks to the backend (`features/facebook`) for a
> real Facebook OAuth connection, Pages, and posts.
