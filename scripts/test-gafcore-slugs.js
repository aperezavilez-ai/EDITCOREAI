const fs = require('fs');
const env = fs.readFileSync('d:\\PROGRAMAS IA\\TAXIDRIV\\.env', 'utf8');
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)/)[1].trim().replace(/^['"]|['"]$/g, '');

async function checkEditCore() {
  const slugs = ["editcore", "editcoreai", "editcore-ai"];
  for (const slug of slugs) {
    try {
      const res = await fetch(`https://supabase.gafcore.com/${slug}/rest/v1/`, {
        headers: { apikey: key, Authorization: "Bearer " + key }
      });
      console.log(`Checking https://supabase.gafcore.com/${slug} -> Status:`, res.status);
    } catch (e) {
      console.log(`Error on ${slug}:`, e.message);
    }
  }
}
checkEditCore();
