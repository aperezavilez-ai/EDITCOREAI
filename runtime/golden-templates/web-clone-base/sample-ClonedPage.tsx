import * as React from "react";
import { FadeIn } from "@/components/motion/FadeIn";

/** Layout clonado / adaptado desde URL externa. */
export function ClonedPage() {
  return (
    <FadeIn className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-6 py-4 flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">EditCore · web clone</p>
        <a href="#cta" className="text-sm font-semibold text-primary hover:underline">Empezar</a>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16 space-y-10">
        <div className="space-y-4">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">LipoBlue Advance</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">Conoce las líneas disponibles de LipoBlue y Nexora Peptides en México y Estados Unidos. Información y disponibilidad bajo consulta por WhatsApp.</p>
        </div>
        <section className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm">
            <h2 className="font-semibold mb-2">Sección principal</h2>
            <p className="text-sm text-muted-foreground">Bloque derivado del layout original.</p>
          </article>
          <article className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm">
            <h2 className="font-semibold mb-2">Sección secundaria</h2>
            <p className="text-sm text-muted-foreground">Personaliza con replacements o visión.</p>
          </article>
        </section>
        <div id="cta" className="flex flex-wrap gap-3">
          <a className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground" href="#">
            Empezar
          </a>
          <span className="text-xs text-muted-foreground self-center">clases ref: wrap nav brand brand-v225 brand-strip links btn menu mobile-menu hero hero-grid eyebrow note hero-img section-head pill </span>
        </div>
      </main>
    </FadeIn>
  );
}

export default ClonedPage;
