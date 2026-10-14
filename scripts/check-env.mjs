/** Format-only validation. Never prints credential values or claims connectivity. */
const errors = [], warnings = [];
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const required = ['APP_URL', 'MONGODB_URI', 'MONGODB_DB', 'DATA_ENCRYPTION_KEY', 'SEARCH_HMAC_KEY'];
if (production) required.push('SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'AWS_REGION', 'S3_BUCKET');
for (const key of required) if (!process.env[key]?.trim()) errors.push(`${key} is missing.`);
for (const key of ['DATA_ENCRYPTION_KEY', 'SEARCH_HMAC_KEY']) {
  const value = process.env[key];
  if (value && (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32)) errors.push(`${key} must be canonical base64 for 32 bytes.`);
}
if (process.env.DATA_ENCRYPTION_KEY && process.env.DATA_ENCRYPTION_KEY === process.env.SEARCH_HMAC_KEY) errors.push('The encryption and search keys must be different.');
if (process.env.APP_URL) {
  try {
    const u = new URL(process.env.APP_URL);
    if (!['http:', 'https:'].includes(u.protocol) || (production && u.protocol !== 'https:')) errors.push('APP_URL must use HTTPS in production (HTTP is allowed only for local development).');
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') errors.push('APP_URL must be an origin without credentials, a path, query or fragment.');
  } catch { errors.push('APP_URL is not a valid URL.'); }
}
if (process.env.MONGODB_URI && !/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI)) errors.push('MONGODB_URI must use mongodb:// or mongodb+srv://.');
if (process.env.MONGODB_DB && /[\s\/\\.\"$\x00]/.test(process.env.MONGODB_DB)) errors.push('MONGODB_DB has invalid characters. Keep the existing valid database name during upgrade.');
if (production && process.env.REQUIRE_PRIVILEGED_MFA !== 'true') errors.push('Production requires REQUIRE_PRIVILEGED_MFA=true.');
if (process.env.SMTP_HOST && ![465, 587].includes(Number(process.env.SMTP_PORT || 465))) errors.push('SMTP_PORT must be 465 (TLS) or 587 (STARTTLS).');
if (process.env.SMTP_FROM && /[\r\n]/.test(process.env.SMTP_FROM)) errors.push('SMTP_FROM must not contain line breaks.');
if (process.env.SECURITY_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SECURITY_EMAIL)) errors.push('SECURITY_EMAIL must be a valid single address.');
try { new Intl.DateTimeFormat('en-US', {timeZone: process.env.REPORT_TIMEZONE || 'Asia/Karachi'}).format(); } catch { errors.push('REPORT_TIMEZONE is not a valid time zone.'); }
if (production && process.env.ADMIN_PASSWORD) errors.push('Remove ADMIN_PASSWORD from the production runtime; use only the one-time bootstrap environment.');
if (!production && (!process.env.SMTP_HOST || !process.env.SMTP_PASSWORD)) warnings.push('Staff new-device login will fail closed until SMTP is configured.');
if (!process.env.S3_BUCKET) warnings.push('Document and logo uploads are disabled until private storage/scanning is configured.');
if (process.env.MAINTENANCE_MODE === 'true') warnings.push('Maintenance mode is enabled; ordinary write APIs are blocked.');
for (const w of warnings) console.warn(`WARNING: ${w}`);
if (errors.length) { for (const e of errors) console.error(e); process.exitCode = 1; }
else console.log(`${production ? 'Production' : 'Development'} environment FORMAT checks passed. Database, SMTP delivery, storage, scanner and browser functionality have NOT been tested.`);
