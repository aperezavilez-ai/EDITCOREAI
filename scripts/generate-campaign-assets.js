const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../web-portal/assets/campaign');
const LOGO_PATH = path.resolve(__dirname, '../web-portal/assets/logo.png').replace(/\\/g, '/');

// Asegurar que existe el directorio de salida
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Convertir el logo oficial a Base64 para inyectarlo sin problemas de CORS/file://
const logoBase64 = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../web-portal/assets/logo.png')).toString('base64')}`;

const baseStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --bg: #050714;
    --bg2: #090d1f;
    --card: rgba(255, 255, 255, 0.04);
    --card-border: rgba(255, 255, 255, 0.08);
    --purple: #6366f1;
    --purple2: #8b5cf6;
    --cyan: #06b6d4;
    --green: #10b981;
    --red: #ef4444;
    --text: #f1f5f9;
    --text2: #94a3b8;
    --text3: #64748b;
  }
  
  body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background-color: var(--bg);
    color: var(--text);
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    -webkit-font-smoothing: antialiased;
  }

  /* Fondo oficial con degradados y orbs */
  .bg-glow {
    position: absolute;
    inset: 0;
    z-index: 0;
    background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.22) 0%, transparent 70%),
                radial-gradient(ellipse 60% 50% at 80% 60%, rgba(6,182,212,0.14) 0%, transparent 60%),
                radial-gradient(ellipse 50% 40% at 20% 80%, rgba(139,92,246,0.12) 0%, transparent 60%);
  }

  .bg-grid {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-image: linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
  }

  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    pointer-events: none;
    z-index: 0;
  }
  .orb-1 { width: 500px; height: 500px; top: -120px; left: -100px; background: radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%); }
  .orb-2 { width: 450px; height: 450px; bottom: -100px; right: -80px; background: radial-gradient(circle, rgba(6,182,212,0.16) 0%, transparent 70%); }

  .content {
    position: relative;
    z-index: 10;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 70px;
  }

  /* Header oficial en piezas */
  .brand-header {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand-logo {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
  }
  .brand-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text);
  }
  .brand-title span {
    color: var(--purple);
  }

  /* Badge oficial */
  .eyebrow-badge {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.3);
    border-radius: 100px;
    padding: 10px 22px;
    font-size: 16px;
    font-weight: 600;
    color: #a5b4fc;
    width: fit-content;
  }
  .eyebrow-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cyan);
    box-shadow: 0 0 10px var(--cyan);
  }

  /* Gradiente oficial de texto */
  .gradient-text {
    background: linear-gradient(135deg, #a5b4fc 0%, var(--cyan) 50%, #f0abfc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Card oficial */
  .glass-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(16px);
    border-radius: 24px;
    padding: 40px;
  }

  /* Botones oficiales */
  .btn-hero-primary {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 18px 36px;
    border-radius: 16px;
    font-weight: 700;
    font-size: 20px;
    color: #fff;
    background: linear-gradient(135deg, var(--purple), var(--purple2));
    box-shadow: 0 12px 40px rgba(99,102,241,0.45);
    text-decoration: none;
  }
  .btn-hero-secondary {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 18px 36px;
    border-radius: 16px;
    font-weight: 700;
    font-size: 20px;
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(12px);
    text-decoration: none;
  }
`;

const templates = [
  // 1. FOTO DE PERFIL OFICIAL (1080x1080)
  {
    filename: 'editcoreai_profile_pic.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="orb orb-1" style="width: 700px; height: 700px; top: 190px; left: 190px;"></div>
        <div class="content" style="justify-content: center; align-items: center; text-align: center; gap: 32px;">
          <img src="${logoBase64}" style="width: 320px; height: 320px; border-radius: 50%; box-shadow: 0 0 80px rgba(99, 102, 241, 0.6); border: 4px solid rgba(255, 255, 255, 0.25);" />
          <div style="font-size: 64px; font-weight: 900; letter-spacing: -2px;">
            EditCore<span style="color: var(--purple);">AI</span>
          </div>
          <div class="eyebrow-badge" style="font-size: 20px; padding: 12px 28px;">
            <span class="eyebrow-dot"></span> IDE + IA + Deploy
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 2. BANNER OFICIAL PARA YOUTUBE / X / LINKEDIN (1920x1080)
  {
    filename: 'editcoreai_banner.png',
    width: 1920,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1" style="width: 700px; height: 700px; top: -100px; left: -100px;"></div>
        <div class="orb orb-2" style="width: 600px; height: 600px; bottom: -100px; right: 100px;"></div>
        <div class="content" style="padding: 90px 120px; justify-content: space-between;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" style="width: 72px; height: 72px;" />
            <div class="brand-title" style="font-size: 36px;">EditCore<span>AI</span></div>
          </div>
          
          <div style="max-width: 1100px;">
            <div class="eyebrow-badge" style="margin-bottom: 28px; font-size: 18px;">
              <span class="eyebrow-dot"></span> Plataforma de Desarrollo con IA &mdash; Web &amp; Desktop
            </div>
            <h1 style="font-size: 88px; font-weight: 900; line-height: 1.08; letter-spacing: -3px; margin-bottom: 24px;">
              Crea. Construye.<br/>
              <span class="gradient-text">Escala sin límites.</span>
            </h1>
            <p style="font-size: 26px; color: var(--text2); max-width: 950px; line-height: 1.6; margin-bottom: 40px;">
              La plataforma inteligente para construir web apps, backends, APIs y proyectos de gran escala. Potencia profesional, sin configuraciones complejas.
            </p>
            <div style="display: flex; gap: 24px; align-items: center;">
              <div class="btn-hero-primary" style="font-size: 22px;">
                <span>🌐 Usar en la Web</span>
              </div>
              <div class="btn-hero-secondary" style="font-size: 22px;">
                <span>🖥 Descargar para Windows</span>
              </div>
              <div style="font-size: 20px; color: #a5b4fc; font-weight: 600; margin-left: 20px;">
                www.editcore.mx
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--card-border); padding-top: 28px; color: var(--text3); font-size: 18px; font-weight: 500;">
            <div>⚡ Deploy 1 Clic (GitHub + Vercel + Supabase)</div>
            <div>🔍 Análisis Forense con Evidencia</div>
            <div>💰 Saldo Prepago · Sin Suscripción Fija</div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 3. CARRUSEL "5 RAZONES" - SLIDE 1 (PORTADA)
  {
    filename: 'carousel_01_cover.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="margin: auto 0;">
            <div class="eyebrow-badge" style="margin-bottom: 24px;">
              <span class="eyebrow-dot"></span> DESARROLLO SIN FRICCIÓN
            </div>
            <h1 style="font-size: 64px; font-weight: 900; line-height: 1.15; letter-spacing: -2px; margin-bottom: 24px;">
              5 razones para dejar de usar <span class="gradient-text">6 herramientas</span> separadas
            </h1>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.6;">
              El desarrollador promedio pierde 2.5 horas al día cambiando de ventanas. EditCoreAI lo une todo.
            </p>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--card-border); padding-top: 24px;">
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza para verlas 👉</span>
            <span style="color: #a5b4fc; font-size: 16px; font-weight: 700;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 4. CARRUSEL "5 RAZONES" - SLIDE 2 (TODO EN ESPAÑOL)
  {
    filename: 'carousel_02_espanol.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div class="glass-card" style="margin: auto 0; padding: 50px;">
            <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; margin-bottom: 16px;">RAZÓN 01</div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); display: flex; align-items: center; justify-content: center; font-size: 32px; color: var(--green);">✓</div>
              <h2 style="font-size: 48px; font-weight: 900; letter-spacing: -1.5px;">100% en Español</h2>
            </div>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 24px;">
              La IA habla tu idioma nativo con terminología precisa. La interfaz, los diagnósticos y las soluciones están en español de LATAM. Cero traducciones mentales ni prompts forzados en inglés.
            </p>
            <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 12px; border-left: 4px solid var(--purple); font-family: monospace; font-size: 16px; color: #e2e8f0;">
              "EditCoreAI: Analicé tu arquitectura y detecté 3 errores en tus rutas de autenticación."
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">2 / 7</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 5. CARRUSEL "5 RAZONES" - SLIDE 3 (SIN CONFIGURACIÓN)
  {
    filename: 'carousel_03_sin_configuracion.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div class="glass-card" style="margin: auto 0; padding: 50px;">
            <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; margin-bottom: 16px;">RAZÓN 02</div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); display: flex; align-items: center; justify-content: center; font-size: 32px; color: var(--green);">✓</div>
              <h2 style="font-size: 48px; font-weight: 900; letter-spacing: -1.5px;">Cero Configuración</h2>
            </div>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 24px;">
              Instala y empieza a construir. No tienes que instalar 30 extensiones, configurar Linters, lidiar con Node zombies ni pelear con puertos ocupados. Todo viene listo de fábrica.
            </p>
            <div style="display: flex; gap: 16px;">
              <span class="eyebrow-badge" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: var(--text2);">Sin extensiones rotas</span>
              <span class="eyebrow-badge" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: var(--text2);">Preview Web integrado</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">3 / 7</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 6. CARRUSEL "5 RAZONES" - SLIDE 4 (PUBLICA SIN SALIR)
  {
    filename: 'carousel_04_publica_1_clic.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div class="glass-card" style="margin: auto 0; padding: 50px;">
            <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; margin-bottom: 16px;">RAZÓN 03</div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(6,182,212,0.15); border: 1px solid rgba(6,182,212,0.3); display: flex; align-items: center; justify-content: center; font-size: 32px; color: var(--cyan);">🚀</div>
              <h2 style="font-size: 48px; font-weight: 900; letter-spacing: -1.5px;">Publica en 1 Clic</h2>
            </div>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 24px;">
              Conexión directa con GitHub, Vercel y tu base de datos Supabase. Presionas el botón azul "Publicar" y tu app queda en producción con SSL y dominio en vivo en segundos.
            </p>
            <div style="display: flex; gap: 14px; align-items: center;">
              <div style="background: rgba(99,102,241,0.2); padding: 12px 20px; border-radius: 10px; font-weight: 700; color: #a5b4fc;">GitHub Push</div>
              <div style="color: var(--text3);">➔</div>
              <div style="background: rgba(6,182,212,0.2); padding: 12px 20px; border-radius: 10px; font-weight: 700; color: #67e8f9;">Vercel Deploy</div>
              <div style="color: var(--text3);">➔</div>
              <div style="background: rgba(16,185,129,0.2); padding: 12px 20px; border-radius: 10px; font-weight: 700; color: #86efac;">Supabase DB</div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">4 / 7</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 7. CARRUSEL "5 RAZONES" - SLIDE 5 (IA CONTEXTO REAL)
  {
    filename: 'carousel_05_ia_contexto.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div class="glass-card" style="margin: auto 0; padding: 50px;">
            <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; margin-bottom: 16px;">RAZÓN 04</div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); display: flex; align-items: center; justify-content: center; font-size: 32px; color: var(--purple);">🧠</div>
              <h2 style="font-size: 46px; font-weight: 900; letter-spacing: -1.5px;">IA con Manos y Ojos</h2>
            </div>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 24px;">
              No es un chatbot que te tira fragmentos de código para que tú adivines dónde pegarlos. EditCoreAI lee tu árbol de archivos, ejecuta análisis forense, detecta bugs y aplica parches con seguridad.
            </p>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 18px; border-radius: 12px; color: #cbd5e1; font-size: 17px;">
              ⚡ Análisis forense determinista: Chequeos reales, archivo por archivo, con evidencia de línea.
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">5 / 7</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 8. CARRUSEL "5 RAZONES" - SLIDE 6 (SALDO PREPAGO)
  {
    filename: 'carousel_06_saldo_prepago.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div class="glass-card" style="margin: auto 0; padding: 50px;">
            <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; margin-bottom: 16px;">RAZÓN 05</div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.3); display: flex; align-items: center; justify-content: center; font-size: 32px; color: #f59e0b;">💰</div>
              <h2 style="font-size: 48px; font-weight: 900; letter-spacing: -1.5px;">Saldo Prepago Justo</h2>
            </div>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 24px;">
              Basta de suscripciones mensuales forzosas de $20 o $30 USD que pagas aunque no programes. En EditCoreAI recargas saldo cuando lo necesitas y solo pagas los tokens exactos que consumes.
            </p>
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); padding: 18px 24px; border-radius: 14px;">
              <span style="font-size: 19px; font-weight: 700; color: var(--green);">Sin mensualidades fijas</span>
              <span style="font-size: 22px; font-weight: 900; color: #fff;">Tú controlas el gasto</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">6 / 7</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Última 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 9. CARRUSEL "5 RAZONES" - SLIDE 7 (CTA FINAL)
  {
    filename: 'carousel_07_cta_final.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="content" style="text-align: center; align-items: center; justify-content: space-between;">
          <div class="brand-header" style="justify-content: center;">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="max-width: 800px;">
            <img src="${logoBase64}" style="width: 140px; height: 140px; border-radius: 50%; box-shadow: 0 0 50px rgba(99, 102, 241, 0.5); border: 3px solid rgba(255, 255, 255, 0.2); margin-bottom: 28px;" />
            <h1 style="font-size: 58px; font-weight: 900; line-height: 1.15; letter-spacing: -2px; margin-bottom: 20px;">
              Empieza a construir <span class="gradient-text">sin límites</span>
            </h1>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.6; margin-bottom: 36px;">
              Descarga EditCoreAI para Windows o pruébalo directamente en la web.
            </p>
            <div style="display: inline-flex; flex-direction: column; gap: 16px; align-items: center;">
              <div class="btn-hero-primary" style="font-size: 24px; padding: 20px 48px;">
                ⬇ Descargar Gratis
              </div>
              <div style="font-size: 22px; color: var(--cyan); font-weight: 700; font-family: monospace;">
                www.editcore.mx/download
              </div>
            </div>
          </div>

          <div style="color: var(--text3); font-size: 17px; font-weight: 600;">
            EditCoreAI &copy; 2026 · Hecho para desarrolladores de LATAM
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 10. POST COMPARATIVA DE PRECIOS OFICIAL (1080x1080)
  {
    filename: 'post_comparativa_precios_oficial.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content" style="padding: 60px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="brand-header">
              <img src="${logoBase64}" class="brand-logo" />
              <div class="brand-title">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">
              <span class="eyebrow-dot"></span> COMPARATIVA DE COSTOS
            </div>
          </div>

          <div style="text-align: center; margin: 10px 0;">
            <h1 style="font-size: 46px; font-weight: 900; letter-spacing: -1.5px;">
              ¿Vale la pena pagar <span style="color: var(--red);">$85 USD/mes</span>?
            </h1>
            <p style="font-size: 18px; color: var(--text2); margin-top: 8px;">
              Compara tu stack de herramientas separadas contra EditCoreAI
            </p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <!-- Herramientas separadas -->
            <div style="background: rgba(239,68,68,0.04); border: 1.5px solid rgba(239,68,68,0.25); border-radius: 20px; padding: 28px;">
              <div style="font-size: 16px; font-weight: 800; color: var(--red); text-transform: uppercase; margin-bottom: 16px;">
                ❌ Herramientas Separadas
              </div>
              <div style="display: flex; flex-direction: column; gap: 12px; font-size: 16px; color: var(--text2);">
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>IDE con IA (Cursor Pro)</span>
                  <strong style="color: #fff;">$20/mes</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>ChatGPT / Claude Pro</span>
                  <strong style="color: #fff;">$20/mes</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>Vercel Pro (Deploy)</span>
                  <strong style="color: #fff;">$20/mes</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>Supabase Pro (Database)</span>
                  <strong style="color: #fff;">$25/mes</strong>
                </div>
              </div>
              <div style="margin-top: 20px; padding-top: 16px; border-top: 2px dashed rgba(239,68,68,0.3); display: flex; justify-content: space-between; align-items: baseline;">
                <span style="font-size: 18px; font-weight: 700; color: var(--red);">Gasto Fijo Mensual:</span>
                <span style="font-size: 34px; font-weight: 900; color: var(--red);">$85 USD</span>
              </div>
            </div>

            <!-- EditCoreAI -->
            <div style="background: rgba(16,185,129,0.05); border: 1.5px solid rgba(16,185,129,0.35); border-radius: 20px; padding: 28px; box-shadow: 0 0 30px rgba(16,185,129,0.1);">
              <div style="font-size: 16px; font-weight: 800; color: var(--green); text-transform: uppercase; margin-bottom: 16px;">
                ✅ EditCoreAI
              </div>
              <div style="display: flex; flex-direction: column; gap: 12px; font-size: 16px; color: var(--text);">
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>IDE + Preview + Terminal</span>
                  <strong style="color: var(--green);">INCLUIDO</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>Agente IA Senior</span>
                  <strong style="color: var(--green);">Pagas lo que usas</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>Deploy 1 Clic (Vercel)</span>
                  <strong style="color: var(--green);">INTEGRADO</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <span>Supabase / Database</span>
                  <strong style="color: var(--green);">INTEGRADO</strong>
                </div>
              </div>
              <div style="margin-top: 20px; padding-top: 16px; border-top: 2px dashed rgba(16,185,129,0.4); display: flex; justify-content: space-between; align-items: baseline;">
                <span style="font-size: 18px; font-weight: 700; color: var(--green);">Gasto Fijo Mensual:</span>
                <span style="font-size: 34px; font-weight: 900; color: var(--green);">$0 USD</span>
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--card-border); padding-top: 20px;">
            <span style="font-size: 18px; color: #cbd5e1; font-weight: 600;">Control total de tu saldo con recargas prepago.</span>
            <span style="font-size: 18px; color: #a5b4fc; font-weight: 700;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 11. STORY COUNTDOWN / TEASER VERTICAL (1080x1920)
  {
    filename: 'story_countdown_oficial.png',
    width: 1080,
    height: 1920,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1" style="width: 800px; height: 800px; top: 300px; left: 140px;"></div>
        <div class="content" style="padding: 100px 80px; text-align: center; justify-content: space-between; align-items: center;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" style="width: 72px; height: 72px;" />
            <div class="brand-title" style="font-size: 32px;">EditCore<span>AI</span></div>
          </div>

          <div style="max-width: 900px;">
            <div class="eyebrow-badge" style="margin-bottom: 40px; font-size: 22px; padding: 14px 32px;">
              <span class="eyebrow-dot"></span> GRAN LANZAMIENTO OFICIAL
            </div>
            
            <img src="${logoBase64}" style="width: 220px; height: 220px; border-radius: 50%; box-shadow: 0 0 100px rgba(99, 102, 241, 0.7); border: 4px solid rgba(255, 255, 255, 0.25); margin-bottom: 48px;" />
            
            <h1 style="font-size: 96px; font-weight: 900; line-height: 1.05; letter-spacing: -3px; margin-bottom: 28px;">
              ALGO GRANDE<br/>
              <span class="gradient-text">SE VIENE.</span>
            </h1>

            <p style="font-size: 30px; color: var(--text2); line-height: 1.6; margin-bottom: 60px;">
              Una nueva forma de crear software con Inteligencia Artificial. Sin saltar entre 6 pestañas.
            </p>

            <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--card-border); border-radius: 20px; padding: 24px; display: inline-block;">
              <div style="font-size: 22px; color: #94a3b8; margin-bottom: 6px;">Octubre 2026</div>
              <div style="font-size: 36px; font-weight: 800; color: #fff;">v4.3.2 Disponible</div>
            </div>
          </div>

          <div>
            <div style="font-size: 26px; color: var(--cyan); font-weight: 700; font-family: monospace; letter-spacing: -0.5px;">
              www.editcore.mx
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 12. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 1 (PORTADA)
  {
    filename: 'carousel_antes_01_cover.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="content">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="margin: auto 0; text-align: center;">
            <div class="eyebrow-badge" style="margin-bottom: 24px;">
              <span class="eyebrow-dot"></span> LA REALIDAD DEL DESARROLLADOR
            </div>
            <h1 style="font-size: 72px; font-weight: 900; line-height: 1.1; letter-spacing: -2.5px; margin-bottom: 24px;">
              <span style="color: var(--red);">Antes</span> vs <span class="gradient-text">Después</span><br/>
              de usar EditCoreAI
            </h1>
            <p style="font-size: 24px; color: var(--text2); line-height: 1.6; max-width: 800px; margin: 0 auto;">
              Así cambia tu día a día cuando dejas de saltar entre 6 herramientas y concentras todo tu flujo en una sola ventana.
            </p>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--card-border); padding-top: 24px;">
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza para comparar 👉</span>
            <span style="color: #a5b4fc; font-size: 16px; font-weight: 700;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 13. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 2 (VENTANAS)
  {
    filename: 'carousel_antes_02_ventanas.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content" style="padding: 60px;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: auto 0;">
            <div style="background: rgba(239,68,68,0.06); border: 2px solid rgba(239,68,68,0.3); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--red); margin-bottom: 20px;">❌ ANTES</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">6 Ventanas Abiertas</h3>
                <p style="font-size: 18px; color: var(--text2); line-height: 1.6;">
                  VS Code + Terminal con Node + 15 pestañas en Chrome + ChatGPT + Consola de Vercel + Supabase Dashboard.
                </p>
              </div>
              <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 12px; color: #fca5a5; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚠️ 2.5 horas perdidas al día en cambio de contexto.
              </div>
            </div>

            <div style="background: rgba(16,185,129,0.06); border: 2px solid rgba(16,185,129,0.4); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 0 30px rgba(16,185,129,0.1);">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--green); margin-bottom: 20px;">✅ DESPUÉS</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">1 Sola Ventana</h3>
                <p style="font-size: 18px; color: var(--text); line-height: 1.6;">
                  Editor Monaco, Agente IA integrado, Preview web interno en vivo, terminal y publicación con 1 clic.
                </p>
              </div>
              <div style="background: rgba(16,185,129,0.12); padding: 16px; border-radius: 12px; color: #86efac; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚡ Enfoque total. Cero Alt+Tab.
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">2 / 6</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 14. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 3 (SETUP)
  {
    filename: 'carousel_antes_03_setup.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content" style="padding: 60px;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: auto 0;">
            <div style="background: rgba(239,68,68,0.06); border: 2px solid rgba(239,68,68,0.3); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--red); margin-bottom: 20px;">❌ ANTES</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">40 Minutos de Setup</h3>
                <p style="font-size: 18px; color: var(--text2); line-height: 1.6;">
                  Instalar 20 extensiones, configurar TypeScript, ESLint, Tailwind, crear el archivo .env, configurar API keys a mano y pelear con errores de arranque.
                </p>
              </div>
              <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 12px; color: #fca5a5; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚠️ Frustración antes de escribir la primera línea.
              </div>
            </div>

            <div style="background: rgba(16,185,129,0.06); border: 2px solid rgba(16,185,129,0.4); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 0 30px rgba(16,185,129,0.1);">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--green); margin-bottom: 20px;">✅ DESPUÉS</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">Instala y Empieza</h3>
                <p style="font-size: 18px; color: var(--text); line-height: 1.6;">
                  Abres EditCoreAI, eliges plantilla o pides al chat crear tu proyecto. Todo el entorno, servidores y herramientas vienen preconfigurados de fábrica.
                </p>
              </div>
              <div style="background: rgba(16,185,129,0.12); padding: 16px; border-radius: 12px; color: #86efac; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚡ Listo en menos de 2 minutos.
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">3 / 6</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 15. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 4 (DEPLOY)
  {
    filename: 'carousel_antes_04_deploy.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content" style="padding: 60px;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: auto 0;">
            <div style="background: rgba(239,68,68,0.06); border: 2px solid rgba(239,68,68,0.3); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--red); margin-bottom: 20px;">❌ ANTES</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">Deploy Frágil y Lento</h3>
                <p style="font-size: 18px; color: var(--text2); line-height: 1.6;">
                  Hacer commit, acordarte de hacer push, abrir el dashboard de Vercel, esperar el build, darte cuenta de que faltaba una variable de entorno y que la BD no sincronizó.
                </p>
              </div>
              <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 12px; color: #fca5a5; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚠️ Builds fallidos y estrés de producción.
              </div>
            </div>

            <div style="background: rgba(16,185,129,0.06); border: 2px solid rgba(16,185,129,0.4); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 0 30px rgba(16,185,129,0.1);">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--green); margin-bottom: 20px;">✅ DESPUÉS</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 20px;">1 Clic: En Producción</h3>
                <p style="font-size: 18px; color: var(--text); line-height: 1.6;">
                  Pulsas el botón azul "Publicar" en la barra superior: sincroniza con GitHub, despliega en Vercel y aplica migraciones en Supabase automáticamente.
                </p>
              </div>
              <div style="background: rgba(16,185,129,0.12); padding: 16px; border-radius: 12px; color: #86efac; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚡ Enlace en vivo en 30 segundos.
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">4 / 6</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 16. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 5 (PRECIOS)
  {
    filename: 'carousel_antes_05_precios.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="content" style="padding: 60px;">
          <div class="brand-header">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: auto 0;">
            <div style="background: rgba(239,68,68,0.06); border: 2px solid rgba(239,68,68,0.3); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--red); margin-bottom: 20px;">❌ ANTES</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 12px;">$85 USD al Mes</h3>
                <div style="font-size: 18px; color: var(--red); font-weight: 700; margin-bottom: 16px;">Gasto fijo obligatorio</div>
                <p style="font-size: 17px; color: var(--text2); line-height: 1.6;">
                  Pagas suscripciones mensuales uses o no las herramientas. Si una semana no programas, igual se te descuenta la mensualidad completa.
                </p>
              </div>
              <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 12px; color: #fca5a5; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚠️ Más de $1,000 USD al año en suscripciones.
              </div>
            </div>

            <div style="background: rgba(16,185,129,0.06); border: 2px solid rgba(16,185,129,0.4); border-radius: 20px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 0 30px rgba(16,185,129,0.1);">
              <div>
                <div style="font-size: 24px; font-weight: 900; color: var(--green); margin-bottom: 20px;">✅ DESPUÉS</div>
                <h3 style="font-size: 34px; font-weight: 800; line-height: 1.2; margin-bottom: 12px;">Saldo Prepago</h3>
                <div style="font-size: 18px; color: var(--green); font-weight: 700; margin-bottom: 16px;">$0 cuota mensual obligatoria</div>
                <p style="font-size: 17px; color: var(--text); line-height: 1.6;">
                  Recargas el saldo que quieras cuando vayas a construir. Los tokens no vencen y solo descuentan lo que la IA procesa.
                </p>
              </div>
              <div style="background: rgba(16,185,129,0.12); padding: 16px; border-radius: 12px; color: #86efac; font-size: 15px; font-family: monospace; margin-top: 24px;">
                ⚡ Control real de tu dinero.
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text3); font-size: 18px;">5 / 6</span>
            <span style="color: var(--text3); font-size: 18px; font-weight: 600;">Última 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 17. CARRUSEL "ANTES VS DESPUÉS" - SLIDE 6 (CTA FINAL)
  {
    filename: 'carousel_antes_06_cta.png',
    width: 1080,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="content" style="text-align: center; align-items: center; justify-content: space-between;">
          <div class="brand-header" style="justify-content: center;">
            <img src="${logoBase64}" class="brand-logo" />
            <div class="brand-title">EditCore<span>AI</span></div>
          </div>
          
          <div style="max-width: 850px;">
            <img src="${logoBase64}" style="width: 140px; height: 140px; border-radius: 50%; box-shadow: 0 0 50px rgba(99, 102, 241, 0.5); border: 3px solid rgba(255, 255, 255, 0.2); margin-bottom: 28px;" />
            <h1 style="font-size: 56px; font-weight: 900; line-height: 1.15; letter-spacing: -2px; margin-bottom: 20px;">
              Pásate al lado <span class="gradient-text">eficiente</span>
            </h1>
            <p style="font-size: 22px; color: var(--text2); line-height: 1.6; margin-bottom: 36px;">
              Descarga EditCoreAI para Windows o pruébalo directamente en la web.
            </p>
            <div style="display: inline-flex; flex-direction: column; gap: 16px; align-items: center;">
              <div class="btn-hero-primary" style="font-size: 24px; padding: 20px 48px;">
                ⬇ Descargar Gratis para Windows
              </div>
              <div style="font-size: 22px; color: var(--cyan); font-weight: 700; font-family: monospace;">
                www.editcore.mx/download
              </div>
            </div>
          </div>

          <div style="color: var(--text3); font-size: 17px; font-weight: 600;">
            EditCoreAI &copy; 2026 · Crea. Construye. Escala sin límites.
          </div>
        </div>
      </body>
      </html>
    `
  }
];

async function generateAll() {
  console.log('Iniciando Puppeteer para generar piezas con branding oficial...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  for (const t of templates) {
    console.log(`Generando: ${t.filename} (${t.width}x${t.height})...`);
    await page.setViewport({ width: t.width, height: t.height, deviceScaleFactor: 1 });
    await page.setContent(t.html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Pequeño delay de 400ms para asegurar renderizado de fuentes y estilos
    await new Promise(r => setTimeout(r, 400));
    
    const outputPath = path.join(OUTPUT_DIR, t.filename);
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Guardado en: ${outputPath}`);
  }

  await browser.close();
  console.log('¡Todas las piezas oficiales fueron generadas exitosamente!');
}

generateAll().catch(err => {
  console.error('Error generando piezas:', err);
  process.exit(1);
});
