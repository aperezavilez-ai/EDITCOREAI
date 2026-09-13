"use strict";

/**
 * Motor de Assets e Identidad Visual para Proyectos de EditCore AI.
 * Provee imágenes temáticas HD curadas por categoría, avatares realistas,
 * banners de alta resolución y generadores de logotipos SVG vectoriales.
 */

const THEMATIC_STOCK_IMAGES = {
  ecommerce: [
    { title: "Modern Fashion Collection", url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Minimalist Watch & Accessories", url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Premium Leather Shoes", url: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Designer Sunglasses", url: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Wireless Audio Headphones", url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Urban Streetwear Apparel", url: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80", tag: "product" },
  ],
  saas: [
    { title: "Futuristic Cloud Technology", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Modern Collaborative Workspace", url: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80", tag: "team" },
    { title: "Data Analytics & Code", url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80", tag: "feature" },
    { title: "AI Network Connections", url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80", tag: "feature" },
  ],
  delivery: [
    { title: "Gourmet Artisan Food", url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Fresh Handcrafted Pizza", url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Healthy Salad Bowl", url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Delicious Angus Burger", url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80", tag: "product" },
    { title: "Fresh Fruit Smoothie", url: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80", tag: "product" },
  ],
  realestate: [
    { title: "Luxury Architectural Home", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Modern Minimalist Living Room", url: "https://images.unsplash.com/photo-1600565193348-f74bd3c7ccdf?auto=format&fit=crop&w=800&q=80", tag: "feature" },
    { title: "Panoramic City View Penthouse", url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80", tag: "feature" },
  ],
  agency: [
    { title: "Creative Digital Studio", url: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Design Sprint Session", url: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=800&q=80", tag: "feature" },
    { title: "Creative Brand Identity", url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80", tag: "feature" },
  ],
  travel: [
    { title: "Tropical Paradise Resort", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Alpine Mountain Expedition", url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80", tag: "feature" },
    { title: "Historic European City", url: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=800&q=80", tag: "feature" },
  ],
  health: [
    { title: "Modern Wellness & Fitness", url: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=1200&q=80", tag: "hero" },
    { title: "Organic Nutrition & Yoga", url: "https://images.unsplash.com/photo-1545205597-3d9d02c29597?auto=format&fit=crop&w=800&q=80", tag: "feature" },
  ],
};

const USER_AVATARS = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=256&q=80",
];

function detectProjectCategory(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  if (/\b(inmobiliari[ao]|propiedad(?:es)?|casas?|departamentos?|rentas?|bienes\s+ra[ií]ces|realestate|apartamentos?)\b/i.test(text)) {
    return "realestate";
  }
  if (/\b(comida|delivery|restaurante|pizza|hamburguesa|platillo|men[uú]|alimento|reparto|ubereats|pedir\s+comida|tacos?|sushi)\b/i.test(text)) {
    return "delivery";
  }
  if (/\b(viajes?|turismo|hoteles?|vuelos?|playas?|resorts?|vacaciones|destinos?|travel|reservas?)\b/i.test(text)) {
    return "travel";
  }
  if (/\b(salud|m[eé]dico|doctores?|cl[ií]nicas?|gym|gimnasios?|fitness|yoga|nutrici[oó]n|bienestar)\b/i.test(text)) {
    return "health";
  }
  if (/\b(agencia|marketing|diseño|portfolio|portafolio|estudio|publicidad|creativo)\b/i.test(text)) {
    return "agency";
  }
  if (/\b(tienda|shop|store|ropa|moda|calzado|zapatos|productos?|carrito|ecommerce|e-commerce|cat[aá]logo|comprar|ventas?)\b/i.test(text)) {
    return "ecommerce";
  }
  if (/\b(saas|software|dashboard|plataforma|analytics|analitica|m[eé]tricas|b2b|api|cloud|crm)\b/i.test(text)) {
    return "saas";
  }
  return "general";
}

function getImagesForProject(prompt = "") {
  const category = detectProjectCategory(prompt);
  const items = THEMATIC_STOCK_IMAGES[category] || THEMATIC_STOCK_IMAGES.saas;
  const hero = items.find((img) => img.tag === "hero") || items[0];
  const products = items.filter((img) => img.tag === "product");
  const features = items.filter((img) => img.tag === "feature");
  const heroUrl = hero?.url || "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80";
  return {
    category,
    hero: heroUrl,
    heroUrl,
    all: items,
    gallery: items.slice(1),
    products: products.length ? products : items.slice(1),
    features: features.length ? features : items.slice(1),
    avatars: USER_AVATARS,
  };
}

function generateSvgLogo({ name = "App", primaryColor = "#6366f1", accentColor = "#a855f7" } = {}) {
  const letter = String(name || "A").trim().charAt(0).toUpperCase();
  const safeName = String(name || "App").replace(/[<>&"]/g, "");
  return `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 rounded-xl shadow-md" data-app="${safeName}">
  <title>${safeName}</title>
  <defs>
    <linearGradient id="logo-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${primaryColor}"/>
      <stop offset="100%" stop-color="${accentColor}"/>
    </linearGradient>
  </defs>
  <rect width="40" height="40" rx="10" fill="url(#logo-grad)"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="22" fill="#ffffff">${letter}</text>
</svg>`;
}

module.exports = {
  THEMATIC_STOCK_IMAGES,
  USER_AVATARS,
  detectProjectCategory,
  getImagesForProject,
  generateSvgLogo,
};
