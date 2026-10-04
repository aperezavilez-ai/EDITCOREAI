---
name: project-templates
description: Elige plantilla EDITCOREAI (blank, react, web-pro, next-saas, etc.) cuando el usuario pide crear un stack. No uses UI de plantillas.
---

# Project templates (agente)

Cuando el usuario pida crear un proyecto o stack:

1. Inferir plantilla:
   - SaaS Next / Next.js + Stripe/Postgres → `next-saas`
   - React + Vite + Supabase / shadcn / app web profesional → `web-pro`
   - React + Vite simple → `react`
   - Open SaaS / Wasp → `open-saas`
   - Suno / lyrics → `soundonemusic`
   - Vacio / desde cero sin stack → `blank`
2. Llamar `create_project` con `name`, `template` (o `auto`) e `install` segun plantilla.
3. Personalizar copy/estructura al pedido; no inventar producto ajeno.
4. Verificar con `npm install` / build solo si la plantilla lo requiere.

No ofrezcas selector de plantillas en UI. Confirma en chat la plantilla elegida y procede.
