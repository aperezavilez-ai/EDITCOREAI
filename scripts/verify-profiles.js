const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!key) {
  console.error("Falta SUPABASE_ANON_KEY: node --env-file=.env.local scripts/verify-profiles.js");
  process.exit(1);
}

async function checkAdminProfile() {
  const url = "https://supabase.gafcore.com/editcore-ai/rest/v1";
  
  // Consultar perfiles
  const res = await fetch(`${url}/profiles?select=*`, {
    headers: { apikey: key, Authorization: "Bearer " + key }
  });
  console.log("Profiles Status:", res.status);
  const data = await res.json();
  console.log("Current Profiles in GafCore:", data);
}
checkAdminProfile();
