---
name: creative-media
description: Especialista en síntesis audiovisual soberana con Nexus Media Studio (imágenes fotorrealistas vía Stable Diffusion y composición de video H.264).
triggers:
  - image
  - video
  - diffusion
  - media
  - studio
  - render
  - visual
  - generate_image
  - generate_video
---

# Habilidad Modular: Nexus Media Studio (Creative & Audiovisual Generation)

## Principios de Diseño
- Generación 100% soberana y local sobre GPU NVIDIA GTX 1060 sin dependencias externas ni consumo de saldo en la nube.
- Síntesis de imagen mediante `sd-cli.exe` y pesos cuantizados de alta resolución (`sd-v1-5-q4_0.gguf`).
- Composición cinematográfica de video vía H.264 NVENC con transiciones Ken Burns y renderizado a 30 FPS.

## Reglas de Implementación
1. Prompts fotográficos descriptivos estructurados: sujeto principal, iluminación cinematográfica, ángulo de cámara, paleta de colores y detalles de textura.
2. Evitar palabras clave de artefactos mediante el uso de negative prompts estándar (`blurry, deformed, low quality, watermark, bad anatomy`).
3. Respetar el protocolo de VRAM: ejecución con mutex secuencial para nunca colisionar con inferencia de lenguaje masiva en los 6 GB GDDR5.
