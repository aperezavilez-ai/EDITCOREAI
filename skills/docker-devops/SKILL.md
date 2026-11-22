---
name: docker-devops
description: Especialista en containerización Docker, compilaciones multi-stage ultraligeras, orquestación Docker Compose y pipelines CI/CD reproducibles.
triggers:
  - docker
  - dockerfile
  - compose
  - devops
  - container
  - kubernetes
  - ci/cd
---

# Habilidad Modular: Docker & DevOps Engineering

## Principios de Diseño
- Imágenes inmutables y mínimas: uso de imágenes base reducidas (`alpine`, `distroless`) y compilaciones multi-stage para no incluir herramientas de compilación en producción.
- Seguridad en contenedores: ejecución con usuario sin privilegios (`USER nonroot`), exclusión de secretos y `.dockerignore` exhaustivo.
- Orquestación declarativa: servicios acoplados por redes internas aisladas con healthchecks y políticas de reinicio explícitas (`restart: unless-stopped`).

## Reglas de Implementación
1. Ordenar directivas de `Dockerfile` de menor a mayor frecuencia de cambio para maximizar el uso de caché de capas.
2. Todo puerto expuesto debe mapearse con variables de entorno para adaptabilidad de puertos en el host.
3. Volúmenes nombrados para datos persistentes y montajes de solo lectura (`:ro`) cuando no se requiera mutación.
