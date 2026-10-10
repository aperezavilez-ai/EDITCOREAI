const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../web-portal/assets/campaign');
const VIDEOS_DIR = path.resolve(OUTPUT_DIR, 'videos');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const logoBase64 = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../web-portal/assets/logo.png')).toString('base64')}`;

// Estilos globales con paleta oficial de www.editcore.mx
const baseStyles = (aspectWidth, aspectHeight) => `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --bg: #050714;
    --bg2: #090d1f;
    --card: rgba(255, 255, 255, 0.04);
    --card-border: rgba(255, 255, 255, 0.09);
    --purple: #6366f1;
    --purple2: #8b5cf6;
    --cyan: #06b6d4;
    --green: #10b981;
    --amber: #f59e0b;
    --text: #f1f5f9;
    --text2: #94a3b8;
    --text3: #64748b;
  }
  
  html, body {
    margin: 0;
    padding: 0;
    width: ${aspectWidth}px;
    height: ${aspectHeight}px;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background-color: var(--bg);
    color: var(--text);
    overflow: hidden;
    position: relative;
    -webkit-font-smoothing: antialiased;
  }

  /* Fondo oficial con degradados elípticos y orbes suaves */
  .bg-glow {
    position: absolute;
    inset: 0;
    z-index: 0;
    background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.22) 0%, transparent 70%),
                radial-gradient(ellipse 60% 50% at 85% 65%, rgba(6,182,212,0.15) 0%, transparent 60%),
                radial-gradient(ellipse 50% 40% at 15% 85%, rgba(139,92,246,0.12) 0%, transparent 60%);
  }

  .bg-grid {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-image: linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at center, black 35%, transparent 85%);
  }

  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(90px);
    pointer-events: none;
    z-index: 0;
  }
  .orb-1 { width: 550px; height: 550px; top: -100px; left: -120px; background: radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%); }
  .orb-2 { width: 500px; height: 500px; bottom: -80px; right: -80px; background: radial-gradient(circle, rgba(6,182,212,0.18) 0%, transparent 70%); }

  .layout-container {
    position: relative;
    z-index: 10;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 70px 64px;
  }

  /* Header unificado */
  .brand-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand-logo-wrap {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand-logo-img {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.45);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
  }
  .brand-name {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text);
  }
  .brand-name span {
    color: var(--purple);
  }

  /* Badges oficiales */
  .eyebrow-badge {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.3);
    border-radius: 100px;
    padding: 8px 20px;
    font-size: 15px;
    font-weight: 700;
    color: #a5b4fc;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .eyebrow-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cyan);
    box-shadow: 0 0 8px var(--cyan);
  }

  /* Gradiente de texto */
  .gradient-text {
    background: linear-gradient(135deg, #a5b4fc 0%, var(--cyan) 50%, #f0abfc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Tarjetas translúcidas amplias */
  .glass-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(20px);
    border-radius: 28px;
    padding: 48px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.4);
  }

  /* Botón CTA oficial */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    padding: 20px 42px;
    border-radius: 16px;
    font-weight: 800;
    font-size: 22px;
    color: #fff;
    background: linear-gradient(135deg, var(--purple), var(--purple2));
    box-shadow: 0 14px 40px rgba(99,102,241,0.45);
  }

  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--card-border);
    padding-top: 24px;
    color: var(--text3);
    font-size: 18px;
    font-weight: 600;
  }
`;

// GENERACIÓN DE IMÁGENES FIJAS 5:7 (1080x1512 px) para Instagram / Facebook
const images5x7 = [
  // 1. COMPARATIVA CONSTRUCTIVA DE MODELOS (POST ESTRELLA)
  {
    filename: 'post_comparativa_modelos_5x7.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">
              <span class="eyebrow-dot"></span> MODELO DE PAGO INTELIGENTE
            </div>
          </div>

          <div style="text-align: center; margin: 24px 0 16px;">
            <h1 style="font-size: 54px; font-weight: 900; line-height: 1.15; letter-spacing: -2px;">
              ¿Suscripción mensual fija o <span class="gradient-text">saldo prepago</span>?
            </h1>
            <p style="font-size: 21px; color: var(--text2); margin-top: 14px; max-width: 850px; margin-left: auto; margin-right: auto; line-height: 1.5;">
              La diferencia entre pagar tarifas forzosas todos los meses o tener el control real de tu presupuesto al programar.
            </p>
          </div>

          <!-- Comparativa centrada y distribuida verticalmente -->
          <div style="display: flex; flex-direction: column; gap: 28px; flex: 1; justify-content: center;">
            <!-- Opción Tradicional -->
            <div style="background: rgba(255,255,255,0.02); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 36px 40px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div style="font-size: 20px; font-weight: 800; color: #fca5a5; text-transform: uppercase; letter-spacing: 0.5px;">
                  El Modelo Tradicional de Suscripciones
                </div>
                <div style="background: rgba(239,68,68,0.15); color: #fca5a5; font-size: 15px; font-weight: 700; padding: 6px 16px; border-radius: 100px;">
                  Cuota Fija Obligatoria
                </div>
              </div>
              <ul style="list-style: none; display: flex; flex-direction: column; gap: 14px; font-size: 18px; color: var(--text2);">
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: #ef4444; font-weight: 800;">✕</span> Cobro automático mensual, uses o no la plataforma esa semana.
                </li>
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: #ef4444; font-weight: 800;">✕</span> Saltas entre 5 herramientas distintas para editar, probar y desplegar.
                </li>
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: #ef4444; font-weight: 800;">✕</span> Múltiples suscripciones separadas que suman más de $80 USD al mes.
                </li>
              </ul>
            </div>

            <!-- Opción EditCoreAI -->
            <div style="background: rgba(99,102,241,0.06); border: 2px solid rgba(99,102,241,0.35); border-radius: 24px; padding: 38px 40px; box-shadow: 0 10px 40px rgba(99,102,241,0.18);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div style="font-size: 22px; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.5px;">
                  EditCoreAI · Tu Entorno Todo en Uno
                </div>
                <div style="background: rgba(16,185,129,0.15); color: #86efac; font-size: 16px; font-weight: 800; padding: 6px 18px; border-radius: 100px;">
                  $0 Suscripción Fija
                </div>
              </div>
              <ul style="list-style: none; display: flex; flex-direction: column; gap: 14px; font-size: 18px; color: var(--text);">
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: var(--green); font-weight: 800;">✓</span> <strong>Saldo Prepago Flexible:</strong> Recargas cuando vas a programar y pagas solo por los tokens que usas.
                </li>
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: var(--green); font-weight: 800;">✓</span> <strong>Conexión con tus servicios:</strong> Conectas tus cuentas de GitHub, Vercel y Supabase directamente al editor.
                </li>
                <li style="display: flex; align-items: center; gap: 12px;">
                  <span style="color: var(--green); font-weight: 800;">✓</span> <strong>Publicación en 1 clic:</strong> La IA actualiza tu repo, migra tu BD y publica en la nube sin salir de la ventana.
                </li>
              </ul>
            </div>
          </div>

          <div class="footer-row" style="margin-top: 24px;">
            <span>Descarga para Windows &bull; Disponible en la web</span>
            <span style="color: var(--cyan); font-weight: 800;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 2. CARRUSEL 5 RAZONES - SLIDE 1 (PORTADA 5:7)
  {
    filename: 'carousel_5x7_01_cover.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>

        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">
              <span class="eyebrow-dot"></span> GUÍA DE PRODUCTIVIDAD
            </div>
          </div>

          <div style="margin: auto 0; text-align: center;">
            <div style="width: 140px; height: 140px; margin: 0 auto 36px; border-radius: 50%; box-shadow: 0 0 60px rgba(99,102,241,0.5); border: 2.5px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; background: rgba(5,7,20,0.8);">
              <img src="${logoBase64}" style="width: 120px; height: 120px; border-radius: 50%;" />
            </div>
            
            <h1 style="font-size: 64px; font-weight: 900; line-height: 1.15; letter-spacing: -2.5px; margin-bottom: 28px;">
              5 razones para consolidar tu desarrollo en <span class="gradient-text">un solo entorno</span>
            </h1>
            
            <p style="font-size: 23px; color: var(--text2); line-height: 1.6; max-width: 820px; margin: 0 auto;">
              Deja atrás el cambio constante entre ventanas, terminales y dashboards de hosting. Descubre una forma más rápida y económica de crear software con IA.
            </p>
          </div>

          <div class="footer-row">
            <span style="color: var(--text3);">Desliza para conocerlas 👉</span>
            <span style="color: #a5b4fc; font-weight: 700;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 3. CARRUSEL 5 RAZONES - SLIDE 2: 100% EN ESPAÑOL
  {
    filename: 'carousel_5x7_02_espanol.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">RAZÓN 01 / 05</div>
          </div>

          <div class="glass-card" style="margin: auto 0; padding: 56px 48px;">
            <div style="width: 72px; height: 72px; border-radius: 18px; background: rgba(16,185,129,0.15); border: 1.5px solid rgba(16,185,129,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; color: var(--green); margin-bottom: 28px;">
              ✓
            </div>
            
            <h2 style="font-size: 50px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.15;">
              100% en Español, pensado para nuestra región
            </h2>
            
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 32px;">
              La interfaz completa, los comandos del asistente y los reportes de diagnóstico se comunican en español natural. Puedes pedir requerimientos complejos con modismos y expresiones locales sin perder precisión técnica.
            </p>

            <div style="background: rgba(0,0,0,0.35); border-left: 4px solid var(--purple); border-radius: 14px; padding: 22px 26px; font-family: monospace; font-size: 17px; color: #cbd5e1; line-height: 1.6;">
              &ldquo;Revisé tu proyecto: la migración de Supabase ya quedó lista y sincronicé las variables en Vercel. ¿Avanzamos con las rutas de API?&rdquo;
            </div>
          </div>

          <div class="footer-row">
            <span>2 / 7</span>
            <span>Desliza para ver la siguiente 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 4. CARRUSEL 5 RAZONES - SLIDE 3: CERO CONFIGURACIÓN
  {
    filename: 'carousel_5x7_03_sin_configuracion.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">RAZÓN 02 / 05</div>
          </div>

          <div class="glass-card" style="margin: auto 0; padding: 56px 48px;">
            <div style="width: 72px; height: 72px; border-radius: 18px; background: rgba(99,102,241,0.15); border: 1.5px solid rgba(99,102,241,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; color: #a5b4fc; margin-bottom: 28px;">
              ⚡
            </div>
            
            <h2 style="font-size: 50px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.15;">
              Cero configuración y cero extensiones rotas
            </h2>
            
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 32px;">
              Olvida pasar horas instalando plugins que luego entran en conflicto entre sí. EditCoreAI incluye editor Monaco de nivel profesional, visualizador web en tiempo real y terminal lista para compilar de fábrica.
            </p>

            <div style="display: flex; flex-direction: column; gap: 16px;">
              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 18px 24px; border-radius: 14px; font-size: 18px; color: var(--text);">
                🖥 <strong>Preview Web y Móvil integrado:</strong> Ve tus cambios al instante sin abrir navegadores externos.
              </div>
              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 18px 24px; border-radius: 14px; font-size: 18px; color: var(--text);">
                🛡 <strong>Protección de código:</strong> Verificación de sintaxis automática antes de guardar cambios.
              </div>
            </div>
          </div>

          <div class="footer-row">
            <span>3 / 7</span>
            <span>Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 5. CARRUSEL 5 RAZONES - SLIDE 4: CONEXIÓN MULTI-SERVICIO
  {
    filename: 'carousel_5x7_04_conexion_servicios.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">RAZÓN 03 / 05</div>
          </div>

          <div class="glass-card" style="margin: auto 0; padding: 56px 48px;">
            <div style="width: 72px; height: 72px; border-radius: 18px; background: rgba(6,182,212,0.15); border: 1.5px solid rgba(6,182,212,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; color: var(--cyan); margin-bottom: 28px;">
              🚀
            </div>
            
            <h2 style="font-size: 50px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.15;">
              Conecta tus servicios y publica en un solo clic
            </h2>
            
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 32px;">
              Enlaza de forma segura tus cuentas personales o de empresa de <strong>GitHub, Vercel y Supabase</strong>. La IA se encarga de subir tu código, estructurar la base de datos y publicar tu aplicación en la nube con un solo botón.
            </p>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; text-align: center;">
              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--card-border); padding: 18px 12px; border-radius: 16px;">
                <div style="font-size: 26px; margin-bottom: 6px;">🐙</div>
                <div style="font-weight: 800; font-size: 16px; color: #fff;">GitHub</div>
                <div style="font-size: 13px; color: var(--text3);">Push automático</div>
              </div>
              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--card-border); padding: 18px 12px; border-radius: 16px;">
                <div style="font-size: 26px; margin-bottom: 6px;">▲</div>
                <div style="font-weight: 800; font-size: 16px; color: #fff;">Vercel</div>
                <div style="font-size: 13px; color: var(--text3);">Deploy en vivo</div>
              </div>
              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--card-border); padding: 18px 12px; border-radius: 16px;">
                <div style="font-size: 26px; margin-bottom: 6px;">⚡</div>
                <div style="font-weight: 800; font-size: 16px; color: #fff;">Supabase</div>
                <div style="font-size: 13px; color: var(--text3);">Tus esquemas y BD</div>
              </div>
            </div>
          </div>

          <div class="footer-row">
            <span>4 / 7</span>
            <span>Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 6. CARRUSEL 5 RAZONES - SLIDE 5: IA CON ANÁLISIS FORENSE
  {
    filename: 'carousel_5x7_05_ia_senior.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">RAZÓN 04 / 05</div>
          </div>

          <div class="glass-card" style="margin: auto 0; padding: 56px 48px;">
            <div style="width: 72px; height: 72px; border-radius: 18px; background: rgba(139,92,246,0.15); border: 1.5px solid rgba(139,92,246,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; color: #c084fc; margin-bottom: 28px;">
              🔍
            </div>
            
            <h2 style="font-size: 50px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.15;">
              Auditoría forense de código con evidencia real
            </h2>
            
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 32px;">
              A diferencia de los chatbots aislados que solo generan texto sin contexto, el agente de EditCoreAI lee los archivos de tu proyecto, detecta dependencias rotas, previene fallos de seguridad y aplica parches verificados línea por línea.
            </p>

            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 20px 24px; border-radius: 16px;">
              <div style="font-weight: 800; font-size: 17px; color: #a5b4fc; margin-bottom: 8px;">Cero alucinaciones sin verificar:</div>
              <div style="font-size: 16px; color: var(--text2); line-height: 1.5;">
                Cada solución se prueba contra el árbol del proyecto para garantizar que tu aplicación siga compilando limpiamente.
              </div>
            </div>
          </div>

          <div class="footer-row">
            <span>5 / 7</span>
            <span>Desliza 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 7. CARRUSEL 5 RAZONES - SLIDE 6: SALDO PREPAGO
  {
    filename: 'carousel_5x7_06_saldo_prepago.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="layout-container">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge">RAZÓN 05 / 05</div>
          </div>

          <div class="glass-card" style="margin: auto 0; padding: 56px 48px;">
            <div style="width: 72px; height: 72px; border-radius: 18px; background: rgba(245,158,11,0.15); border: 1.5px solid rgba(245,158,11,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; color: var(--amber); margin-bottom: 28px;">
              💰
            </div>
            
            <h2 style="font-size: 50px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.15;">
              Saldo prepago: pagas lo que usas, sin ataduras
            </h2>
            
            <p style="font-size: 22px; color: var(--text2); line-height: 1.65; margin-bottom: 32px;">
              No estás obligado a pagar suscripciones mensuales que te descuentan dinero aunque estés de vacaciones o no estés programando. Recargas el saldo que quieras y se descuenta únicamente con los tokens que consumes.
            </p>

            <div style="background: rgba(16,185,129,0.06); border: 1.5px solid rgba(16,185,129,0.3); border-radius: 18px; padding: 24px 28px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 16px; color: var(--green); font-weight: 800; text-transform: uppercase;">Sin cuotas fijas obligatorias</div>
                <div style="font-size: 24px; font-weight: 900; color: #fff; margin-top: 4px;">Tú decides cuándo recargar</div>
              </div>
              <div style="font-size: 36px;">💳</div>
            </div>
          </div>

          <div class="footer-row">
            <span>6 / 7</span>
            <span>Última diapositiva 👉</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 8. CARRUSEL 5 RAZONES - SLIDE 7: CTA FINAL
  {
    filename: 'carousel_5x7_07_cta_final.png',
    width: 1080,
    height: 1512,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1512)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>

        <div class="layout-container" style="text-align: center;">
          <div class="brand-header" style="justify-content: center;">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" />
              <div class="brand-name">EditCore<span>AI</span></div>
            </div>
          </div>

          <div style="margin: auto 0; max-width: 860px; margin-left: auto; margin-right: auto;">
            <div style="width: 140px; height: 140px; margin: 0 auto 36px; border-radius: 50%; box-shadow: 0 0 70px rgba(99,102,241,0.6); border: 3px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; background: rgba(5,7,20,0.85);">
              <img src="${logoBase64}" style="width: 120px; height: 120px; border-radius: 50%;" />
            </div>

            <h1 style="font-size: 60px; font-weight: 900; line-height: 1.15; letter-spacing: -2px; margin-bottom: 24px;">
              Empieza a construir <span class="gradient-text">sin límites</span>
            </h1>

            <p style="font-size: 23px; color: var(--text2); line-height: 1.6; margin-bottom: 44px;">
              Descarga la aplicación para Windows o pruébalo directamente desde tu navegador en la web.
            </p>

            <div style="display: inline-flex; flex-direction: column; gap: 18px; align-items: center;">
              <div class="btn-primary" style="font-size: 24px; padding: 22px 52px; border-radius: 18px;">
                ⬇ Descargar Gratis
              </div>
              <div style="font-size: 22px; color: var(--cyan); font-weight: 700; font-family: monospace;">
                www.editcore.mx/download
              </div>
            </div>
          </div>

          <div class="footer-row" style="justify-content: center;">
            <span>EditCoreAI &copy; 2026 &bull; Potencia para desarrolladores en LATAM</span>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 9. STORY / TIKTOK COVER VERTICAL (9:16 - 1080x1920)
  {
    filename: 'story_countdown_9x16.png',
    width: 1080,
    height: 1920,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1080, 1920)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1" style="width: 800px; height: 800px; top: 250px; left: 140px;"></div>

        <div class="layout-container" style="padding: 110px 80px; text-align: center; justify-content: space-between;">
          <div class="brand-header" style="justify-content: center;">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" style="width: 68px; height: 68px;" />
              <div class="brand-name" style="font-size: 34px;">EditCore<span>AI</span></div>
            </div>
          </div>

          <div style="max-width: 900px; margin: auto 0;">
            <div class="eyebrow-badge" style="margin-bottom: 44px; font-size: 20px; padding: 12px 28px;">
              <span class="eyebrow-dot"></span> LANZAMIENTO OFICIAL
            </div>

            <div style="width: 220px; height: 220px; margin: 0 auto 52px; border-radius: 50%; box-shadow: 0 0 100px rgba(99,102,241,0.7); border: 4px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; background: rgba(5,7,20,0.85);">
              <img src="${logoBase64}" style="width: 190px; height: 190px; border-radius: 50%;" />
            </div>

            <h1 style="font-size: 88px; font-weight: 900; line-height: 1.08; letter-spacing: -3.5px; margin-bottom: 32px;">
              CREA.<br/>
              CONSTRUYE.<br/>
              <span class="gradient-text">SIN LÍMITES.</span>
            </h1>

            <p style="font-size: 28px; color: var(--text2); line-height: 1.6; margin-bottom: 56px;">
              IDE + Asistente IA + Deploy unificado.<br/>Pagas lo que usas, sin mensualidades fijas.
            </p>

            <div style="display: inline-block; background: rgba(255,255,255,0.05); border: 1.5px solid var(--card-border); padding: 24px 44px; border-radius: 22px;">
              <div style="font-size: 32px; font-weight: 900; color: #fff;">v4.3.2 Disponible</div>
              <div style="font-size: 20px; color: #a5b4fc; margin-top: 4px;">Para Windows y en la Web</div>
            </div>
          </div>

          <div>
            <div style="font-size: 26px; color: var(--cyan); font-weight: 800; font-family: monospace;">
              www.editcore.mx
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 10. MINIATURA PARA YOUTUBE (16:9 - 1920x1080)
  {
    filename: 'youtube_thumbnail_16x9.png',
    width: 1920,
    height: 1080,
    html: `
      <!DOCTYPE html>
      <html>
      <head><style>${baseStyles(1920, 1080)}</style></head>
      <body>
        <div class="bg-glow"></div>
        <div class="bg-grid"></div>
        <div class="orb orb-1" style="width: 750px; height: 750px; top: -100px; left: -100px;"></div>
        <div class="orb orb-2" style="width: 700px; height: 700px; bottom: -100px; right: 80px;"></div>

        <div class="layout-container" style="padding: 80px 100px; justify-content: space-between;">
          <div class="brand-header">
            <div class="brand-logo-wrap">
              <img src="${logoBase64}" class="brand-logo-img" style="width: 64px; height: 64px;" />
              <div class="brand-name" style="font-size: 34px;">EditCore<span>AI</span></div>
            </div>
            <div class="eyebrow-badge" style="font-size: 18px; padding: 10px 24px;">
              <span class="eyebrow-dot"></span> TUTORIAL &middot; DEMO COMPLETA
            </div>
          </div>

          <div style="max-width: 1300px;">
            <h1 style="font-size: 88px; font-weight: 900; line-height: 1.08; letter-spacing: -3px; margin-bottom: 24px;">
              De cero a producción<br/>
              en <span class="gradient-text">una sola ventana</span>
            </h1>
            <p style="font-size: 28px; color: var(--text2); line-height: 1.6; max-width: 1000px; margin-bottom: 40px;">
              Aprende cómo crear, auditar y desplegar una app completa con IA conectada a GitHub, Vercel y Supabase.
            </p>
            <div style="display: flex; gap: 24px; align-items: center;">
              <div class="btn-primary" style="font-size: 24px; padding: 20px 48px;">
                ▶ Ver Demostración en Vivo
              </div>
              <div style="font-size: 22px; color: #a5b4fc; font-weight: 700; margin-left: 16px;">
                Sin suscripción mensual fija
              </div>
            </div>
          </div>

          <div class="footer-row" style="font-size: 20px;">
            <span>⚡ Editor Monaco + IA Senior + Preview integrado</span>
            <span style="color: var(--cyan); font-weight: 800;">www.editcore.mx</span>
          </div>
        </div>
      </body>
      </html>
    `
  }
];

// GENERACIÓN DE VIDEOS ANIMADOS REALES (TikTok 9:16 y YouTube 16:9) MEDIANTE MEDIARECORDER
async function recordHtmlVideo(browser, { filename, width, height, durationSec, getHtml }) {
  console.log(`Grabando video animado: ${filename} (${width}x${height}, ${durationSec}s)...`);
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const htmlContent = getHtml(width, height, durationSec);
  await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

  // Iniciar MediaRecorder dentro de la página para capturar el canvas o el DOM animado
  const videoBufferBase64 = await page.evaluate(async (duration) => {
    return new Promise((resolve, reject) => {
      try {
        const stream = document.querySelector('canvas').captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        const chunks = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            resolve(base64data);
          };
          reader.readAsDataURL(blob);
        };

        recorder.start();
        setTimeout(() => {
          recorder.stop();
        }, duration * 1000);
      } catch (err) {
        reject(err.message);
      }
    });
  }, durationSec);

  const videoBuffer = Buffer.from(videoBufferBase64, 'base64');
  const outputPath = path.join(VIDEOS_DIR, filename);
  fs.writeFileSync(outputPath, videoBuffer);
  console.log(`Video guardado exitosamente en: ${outputPath} (${(videoBuffer.length / 1024).toFixed(1)} KB)`);
  await page.close();
}

// Plantilla Canvas animada para TikTok (9:16 - 1080x1920)
function getTikTokCanvasHtml(width, height, durationSec, titleText, points) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; background: #050714; overflow: hidden; display: flex; justify-content: center; align-items: center; }
        canvas { width: 100vw; height: 100vh; }
      </style>
    </head>
    <body>
      <canvas id="c" width="${width}" height="${height}"></canvas>
      <script>
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const totalDuration = ${durationSec};
        const startTime = performance.now();

        const logoImg = new Image();
        logoImg.src = "${logoBase64}";

        function drawFrame(now) {
          const elapsed = (now - startTime) / 1000;
          const progress = Math.min(1, elapsed / totalDuration);

          // Fondo oscuro oficial
          ctx.fillStyle = '#050714';
          ctx.fillRect(0, 0, W, H);

          // Orbes animados flotantes
          const pulse = Math.sin(elapsed * 2) * 30;
          const grad1 = ctx.createRadialGradient(200, 300 + pulse, 10, 200, 300 + pulse, 450);
          grad1.addColorStop(0, 'rgba(99, 102, 241, 0.28)');
          grad1.addColorStop(1, 'transparent');
          ctx.fillStyle = grad1;
          ctx.fillRect(0, 0, W, H);

          const grad2 = ctx.createRadialGradient(W - 200, H - 350 - pulse, 10, W - 200, H - 350 - pulse, 400);
          grad2.addColorStop(0, 'rgba(6, 182, 212, 0.2)');
          grad2.addColorStop(1, 'transparent');
          ctx.fillStyle = grad2;
          ctx.fillRect(0, 0, W, H);

          // Header con logo
          if (logoImg.complete) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(W / 2, 280, 75, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(logoImg, W / 2 - 75, 205, 150, 150);
            ctx.restore();
          }

          // Texto de marca
          ctx.font = '900 48px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('EditCore', W / 2 - 25, 410);
          ctx.fillStyle = '#6366f1';
          ctx.fillText('AI', W / 2 + 95, 410);

          // Badge
          ctx.font = '700 24px Inter, sans-serif';
          ctx.fillStyle = '#a5b4fc';
          ctx.fillText('● IDE + IA + DEPLOY UNIFICADO', W / 2, 460);

          // Título principal con animación de aparición
          ctx.font = '900 68px Inter, sans-serif';
          ctx.fillStyle = '#ffffff';
          const titleLines = ${JSON.stringify(titleText)};
          titleLines.forEach((line, idx) => {
            ctx.fillText(line, W / 2, 600 + (idx * 85));
          });

          // Puntos clave animados en secuencia
          const points = ${JSON.stringify(points)};
          points.forEach((pt, idx) => {
            const itemTime = 1.0 + (idx * 1.8);
            if (elapsed >= itemTime) {
              const alpha = Math.min(1, (elapsed - itemTime) * 2);
              ctx.save();
              ctx.globalAlpha = alpha;

              const boxY = 820 + (idx * 170);
              // Card translúcida
              ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
              ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.roundRect(100, boxY, W - 200, 135, 24);
              ctx.fill();
              ctx.stroke();

              // Ícono y texto
              ctx.font = '800 32px Inter, sans-serif';
              ctx.textAlign = 'left';
              ctx.fillStyle = '#06b6d4';
              ctx.fillText(pt.icon, 140, boxY + 60);

              ctx.fillStyle = '#ffffff';
              ctx.fillText(pt.title, 205, boxY + 58);

              ctx.font = '500 24px Inter, sans-serif';
              ctx.fillStyle = '#94a3b8';
              ctx.fillText(pt.desc, 205, boxY + 100);

              ctx.restore();
            }
          });

          // CTA en la parte inferior
          if (elapsed >= totalDuration - 2.5) {
            const ctaAlpha = Math.min(1, (elapsed - (totalDuration - 2.5)) * 2);
            ctx.save();
            ctx.globalAlpha = ctaAlpha;
            ctx.font = '900 34px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('www.editcore.mx/download', W / 2, H - 200);
            ctx.font = '600 24px Inter, sans-serif';
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText('Disponible gratis para Windows', W / 2, H - 150);
            ctx.restore();
          }

          // Intervalo continuo garantizado para headless video
        }

        setInterval(() => {
          drawFrame(performance.now());
        }, 1000 / 30);
      </script>
    </body>
    </html>
  `;
}

// Plantilla Canvas animada para YouTube (16:9 - 1920x1080)
function getYouTubeCanvasHtml(width, height, durationSec) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; background: #050714; overflow: hidden; display: flex; justify-content: center; align-items: center; }
        canvas { width: 100vw; height: 100vh; }
      </style>
    </head>
    <body>
      <canvas id="c" width="${width}" height="${height}"></canvas>
      <script>
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const totalDuration = ${durationSec};
        const startTime = performance.now();

        const logoImg = new Image();
        logoImg.src = "${logoBase64}";

        function drawFrame(now) {
          const elapsed = (now - startTime) / 1000;

          // Fondo espacial
          ctx.fillStyle = '#050714';
          ctx.fillRect(0, 0, W, H);

          // Orbes
          const pulse = Math.sin(elapsed * 1.5) * 40;
          const g1 = ctx.createRadialGradient(350, 450 + pulse, 20, 350, 450 + pulse, 650);
          g1.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
          g1.addColorStop(1, 'transparent');
          ctx.fillStyle = g1;
          ctx.fillRect(0, 0, W, H);

          const g2 = ctx.createRadialGradient(W - 400, H - 350 - pulse, 20, W - 400, H - 350 - pulse, 600);
          g2.addColorStop(0, 'rgba(6, 182, 212, 0.22)');
          g2.addColorStop(1, 'transparent');
          ctx.fillStyle = g2;
          ctx.fillRect(0, 0, W, H);

          // Barra superior
          if (logoImg.complete) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(140, 110, 40, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(logoImg, 100, 70, 80, 80);
            ctx.restore();
          }

          ctx.font = '800 36px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('EditCore', 200, 122);
          ctx.fillStyle = '#6366f1';
          ctx.fillText('AI', 355, 122);

          // Badge derecha
          ctx.font = '700 18px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#a5b4fc';
          ctx.fillText('LANZAMIENTO OFICIAL v4.3.2', W - 100, 122);

          // Titulares
          ctx.textAlign = 'left';
          ctx.font = '900 76px Inter, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('Crea. Construye.', 100, 310);
          ctx.fillStyle = '#38bdf8';
          ctx.fillText('Escala sin límites.', 100, 400);

          ctx.font = '500 28px Inter, sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('El entorno con IA integrada que conecta tu código con tus propios servicios.', 100, 475);

          // 3 Columnas animadas
          const features = [
            { icon: '🐙', title: 'GitHub + Vercel + Supabase', desc: 'Conectas tus cuentas y publicas en 1 clic.' },
            { icon: '🔍', title: 'Análisis Forense Real', desc: 'Auditoría con evidencia y parches seguros.' },
            { icon: '💳', title: 'Saldo Prepago Flexible', desc: '$0 cuota mensual obligatoria. Pagas lo que usas.' }
          ];

          features.forEach((f, idx) => {
            const fTime = 1.2 + (idx * 1.5);
            if (elapsed >= fTime) {
              const alpha = Math.min(1, (elapsed - fTime) * 2);
              ctx.save();
              ctx.globalAlpha = alpha;

              const colW = 540;
              const colX = 100 + (idx * (colW + 40));
              const colY = 560;

              ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
              ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.roundRect(colX, colY, colW, 280, 24);
              ctx.fill();
              ctx.stroke();

              ctx.font = '48px Inter';
              ctx.fillText(f.icon, colX + 40, colY + 80);

              ctx.font = '800 26px Inter, sans-serif';
              ctx.fillStyle = '#ffffff';
              ctx.fillText(f.title, colX + 40, colY + 145);

              ctx.font = '500 20px Inter, sans-serif';
              ctx.fillStyle = '#94a3b8';
              ctx.fillText(f.desc, colX + 40, colY + 195);

              ctx.restore();
            }
          });

          // Barra inferior
          ctx.font = '700 26px Inter, monospace';
          ctx.fillStyle = '#06b6d4';
          ctx.fillText('www.editcore.mx/download', 100, H - 75);

          ctx.textAlign = 'right';
          ctx.font = '500 22px Inter, sans-serif';
          ctx.fillStyle = '#64748b';
          ctx.fillText('Disponible gratis para Windows &bull; Versión Web disponible', W - 100, H - 75);

          // Loop continuo garantizado
        }

        setInterval(() => {
          drawFrame(performance.now());
        }, 1000 / 30);
      </script>
    </body>
    </html>
  `;
}

async function runFullPipeline() {
  console.log('--- INICIANDO GENERACIÓN COMPLETA DE ASSETS Y VIDEOS ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. GENERAR IMÁGENES 5:7, 9:16 y 16:9
  const page = await browser.newPage();
  for (const img of images5x7) {
    console.log(`Renderizando imagen: ${img.filename} (${img.width}x${img.height})...`);
    await page.setViewport({ width: img.width, height: img.height, deviceScaleFactor: 1 });
    await page.setContent(img.html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 450));
    const outPath = path.join(OUTPUT_DIR, img.filename);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`OK -> ${outPath}`);
  }
  await page.close();

  // 2. GENERAR VIDEOS PARA TIKTOK / REELS (9:16 - 1080x1920)
  const tiktokVideos = [
    {
      filename: 'tiktok_reel_01_por_que_editcoreai.webm',
      width: 1080,
      height: 1920,
      durationSec: 8,
      getHtml: (w, h, dur) => getTikTokCanvasHtml(w, h, dur, ['¿POR QUÉ CAMBIAR', 'DE ENTORNO?'], [
        { icon: '1', title: 'Cero Alt+Tab', desc: 'IDE, Terminal y Preview en una sola ventana.' },
        { icon: '2', title: 'Tus Cuentas Directas', desc: 'GitHub, Vercel y Supabase conectados.' },
        { icon: '3', title: 'Sin Cuota Fija Mensual', desc: 'Saldo prepago: pagas solo lo que construyes.' }
      ])
    },
    {
      filename: 'tiktok_reel_02_deploy_en_un_clic.webm',
      width: 1080,
      height: 1920,
      durationSec: 8,
      getHtml: (w, h, dur) => getTikTokCanvasHtml(w, h, dur, ['DE CERO A NUBE', 'EN 1 SOLO CLIC'], [
        { icon: '🚀', title: 'GitHub Push', desc: 'Sincroniza tus cambios automáticamente.' },
        { icon: '⚡', title: 'Supabase Migrations', desc: 'Aplica tablas en tu propia base de datos.' },
        { icon: '🌐', title: 'Vercel Producción', desc: 'Tu sitio con dominio en vivo en 30 segundos.' }
      ])
    },
    {
      filename: 'tiktok_reel_03_modelo_prepago.webm',
      width: 1080,
      height: 1920,
      durationSec: 8,
      getHtml: (w, h, dur) => getTikTokCanvasHtml(w, h, dur, ['DEJA DE PAGAR', 'MENSUALIDADES FIJAS'], [
        { icon: '💳', title: '$0 Tarifa Forzosa', desc: 'Sin suscripciones obligatorias recurrentes.' },
        { icon: '🪙', title: 'Tú Decides Cuánto', desc: 'Recarga el saldo que necesites para tu app.' },
        { icon: '⏳', title: 'Tokens Sin Vencimiento', desc: 'Solo descuenta lo que la IA procesa.' }
      ])
    }
  ];

  for (const tv of tiktokVideos) {
    await recordHtmlVideo(browser, tv);
  }

  // 3. GENERAR VIDEO PROMO PARA YOUTUBE (16:9 - 1920x1080)
  const youtubeVideo = {
    filename: 'youtube_promo_lanzamiento_16x9.webm',
    width: 1920,
    height: 1080,
    durationSec: 9,
    getHtml: (w, h, dur) => getYouTubeCanvasHtml(w, h, dur)
  };
  await recordHtmlVideo(browser, youtubeVideo);

  await browser.close();
  console.log('--- GENERACIÓN COMPLETA EXITOSA ---');
}

runFullPipeline().catch(err => {
  console.error('Error en pipeline:', err);
  process.exit(1);
});
