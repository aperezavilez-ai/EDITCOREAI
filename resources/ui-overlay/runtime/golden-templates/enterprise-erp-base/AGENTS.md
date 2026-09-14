# Enterprise ERP — agent rules

## Schema-first (obligatorio)
1. Stage 1: crear/validar migraciones SQL en `supabase/migrations/` antes de UI.
2. Stage 2: generar CRUD UI solo contra tablas/columnas ya validadas.
3. Nunca inventar columnas que no existan en el schema.

## Módulos
- Usa `add_erp_module` para Inventory / Payroll / Invoicing / CRM.
- No sobrescribas `src/lib/supabaseClient.ts` ni el shell de navegación core.
