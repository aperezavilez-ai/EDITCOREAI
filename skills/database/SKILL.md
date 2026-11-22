---
name: database
description: Especialista en diseño de esquemas SQL relacionales (SQLite / PostgreSQL), optimización de índices, migraciones seguras y transaccionalidad ACID.
triggers:
  - sql
  - sqlite
  - postgres
  - postgresql
  - database
  - schema
  - migration
  - index
---

# Habilidad Modular: Database Architecture & Engineering

## Principios de Diseño
- Esquemas 3NF con integridad referencial estricta (`FOREIGN KEY`, `ON DELETE RESTRICT/CASCADE`).
- Indexación estratégica: índices compuestos ordenados por selectividad, índices únicos para claves candidatas y evitación de escaneos de tabla completos (`Seq Scan`).
- Transacciones atómicas seguras: toda mutación multi-tabla debe ejecutarse dentro de un bloque transaccional con manejo de rollback explícito.

## Reglas de Implementación
1. Toda columna que participe en cláusulas `WHERE`, `JOIN` o `ORDER BY` en rutas críticas debe tener un índice justificado.
2. Migraciones incrementales e idempotentes: verificar existencia de tablas y columnas antes de alterar esquemas (`IF NOT EXISTS`).
3. Sentencias parametrizadas obligatorias: cero concatenación de cadenas en SQL para prevenir inyecciones.
