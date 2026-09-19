const fs = require('fs');
const env = fs.readFileSync('d:\\PROGRAMAS IA\\TAXIDRIV\\.env', 'utf8');
const urlMatch = env.match(/SUPABASE_URL\s*=\s*(.*)/);
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)/);

async function testConn() {
  if (urlMatch && keyMatch) {
    const url = urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const key = keyMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const origin = new URL(url).origin;
    console.log("Supabase Platform Origin:", origin);
    console.log("Project Base URL:", url);

    try {
      const res = await fetch(url + "/rest/v1/", {
        headers: { apikey: key, Authorization: "Bearer " + key }
      });
      console.log("Connection Response HTTP Status:", res.status);
    } catch (e) {
      console.log("Connection error:", e.message);
    }
  } else {
    console.log("Could not find SUPABASE_URL in taxidriv env");
  }
}
testConn();
