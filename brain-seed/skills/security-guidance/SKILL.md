---
name: security-guidance
description: "Reference of 25 common vulnerability patterns (injection, unsafe deserialization, XSS, weak crypto, TLS bypass, XXE) with safe alternatives, by language/file type. Use whenever writing or editing code that runs shell commands, evaluates strings, deserializes data, builds HTML, handles crypto/TLS, or parses XML — check the diff against this list before finishing, and self-report any match you didn't already fix."
homepage: https://github.com/anthropics/claude-plugins-official (security-guidance)
license: MIT
---

# Security guidance

Before finishing any task that writes or edits code, scan what you touched
against these patterns. If a match is intentional (e.g. `eval()` on a fully
trusted, hardcoded string), say so in one line instead of silently leaving it.

## Injection (command / code)

- **`child_process.exec()` / `execSync()`** (JS/TS) — shell-interpolates the whole string. Use `execFile()`/`spawn()` with an argument array instead.
- **`os.system()`** (Python) — shell injection sink. Use `subprocess.run([...])` with a list.
- **`subprocess.run/call/Popen/check_output/check_call(..., shell=True)`** (Python) — same issue when combined with string interpolation. Pass a list, drop `shell=True`.
- **`exec.Command("sh"/"bash", "-c", ...)`** (Go) — pass the target binary and args directly, no shell.
- **`eval()`** — arbitrary code execution. Use `JSON.parse()` / `ast.literal_eval()` / a real expression parser.
- **`new Function(...)` with interpolated strings** (JS) — code injection. Use property access (`obj[key]`) or a safe expression parser instead of building a function body from strings.
- **GitHub Actions workflows** (`.github/workflows/*.yml`) — never interpolate untrusted `${{ github.event.* }}` fields (issue/PR title, body, comments, commit messages, `head_ref`, `client_payload.*`) directly into `run:`. Pass them through `env:` and reference the env var. Never use untrusted input in `actions/checkout`'s `ref:` without validating format first.

## Unsafe deserialization

All of these allow arbitrary code execution from untrusted input — prefer JSON/msgspec for data, or a schema-validated deserializer (pydantic/msgspec.Struct/marshmallow) for typed objects:
- Python: `pickle.load(s)`/`Unpickler`, `cPickle`/`cloudpickle`/`dill`.load(s), `marshal.loads`, `shelve.open`, `joblib.load`, `pandas.read_pickle`, `numpy.load(..., allow_pickle=True)`.
- `yaml.load()` without a `Safe*` loader, and `yaml.unsafe_load()` — use `yaml.safe_load()`, validate against a schema if you need typed objects.
- `torch.load()` without `weights_only=True` — set it (or `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1`) unless the file is known to contain more than tensors.
- XML: `xml.etree.ElementTree`/`minidom`/`xml.sax` parse/fromstring — vulnerable to XXE and billion-laughs by default. Use `defusedxml`.

## XSS (browser DOM, JS/TS only)

- `dangerouslySetInnerHTML` (React), `.innerHTML =`, `.outerHTML =`, `document.write()`, `.insertAdjacentHTML(...)` — all are injection sinks for untrusted content. Prefer `textContent` / safe DOM methods, or sanitize with DOMPurify first if HTML is genuinely needed.
- `<script src="https://...">` without `integrity="sha384-..." crossorigin="anonymous"` — no Subresource Integrity means a compromised CDN can inject arbitrary JS.

## Crypto & TLS

- `crypto.createCipher()`/`createDecipher()` (Node) — insecure key derivation, no IV. Use `createCipheriv()`/`createDecipheriv()`.
- AES-ECB mode (`AES.MODE_ECB`, `modes.ECB(...)`, `"aes-*-ecb"`) — leaks plaintext structure. Use AES-GCM, or AES-CBC + HMAC.
- Disabling TLS verification (`verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify: true`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `ssl._create_unverified_context`, `check_hostname=False`) — enables MITM. For self-signed dev certs, add the CA to the trust store instead.

## Applying this

Path-gate by file type before flagging — e.g. `eval(` in a `.md` file is prose, not code; `.innerHTML` only matters in `.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts/.vue/.svelte`. When a match is genuinely intentional and safe, leave a one-line comment explaining why instead of silently proceeding — that comment is what the next reviewer (human or agent) needs to not re-flag it.
