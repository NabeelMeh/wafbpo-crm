import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
function derivePassword(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
function secret(name: string): Buffer {
    const raw = process.env[name];
    if (!raw)
        throw new Error(`Missing ${name}; configure a 32-byte base64 secret.`);
    const b = Buffer.from(raw, "base64");
    if (b.length !== 32)
        throw new Error(`${name} must decode to exactly 32 bytes.`);
    return b;
}
export function seal(value: unknown, context: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret("DATA_ENCRYPTION_KEY"), iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function unseal<T>(value: string, context: string): T {
    const [v, iv, tag, data] = value.split(".");
    if (v !== "v1" || !iv || !tag || !data)
        throw new Error("Invalid encrypted value.");
    const decipher = createDecipheriv("aes-256-gcm", secret("DATA_ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as T;
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const blind = (value: string) => createHmac("sha256", secret("SEARCH_HMAC_KEY")).update(value).digest("hex");
export function sameSecret(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await derivePassword(password, salt);
    return `scrypt$32768$8$1$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    try {
        const [alg, n, r, p, salt, hash] = stored.split("$");
        if (alg !== "scrypt" || n !== "32768" || r !== "8" || p !== "1" || !salt || !hash)
            return false;
        const actual = await derivePassword(password, salt);
        const expected = Buffer.from(hash, "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Buffer): string {
    let acc = 0, bits = 0, out = "";
    for (const b of bytes) {
        acc = (acc << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32[(acc >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits)
        out += B32[(acc << (5 - bits)) & 31];
    return out;
}
export function decodeBase32(s: string): Buffer {
    let acc = 0, bits = 0;
    const bytes: number[] = [];
    for (const c of s.toUpperCase().replace(/=+$/, "")) {
        const v = B32.indexOf(c);
        if (v < 0)
            throw new Error("Invalid base32 secret.");
        acc = (acc << 5) | v;
        bits += 5;
        if (bits >= 8) {
            bytes.push((acc >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}
export function totp(secretValue: string, step: number, digits = 6): string {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(step));
    const h = createHmac("sha1", decodeBase32(secretValue)).update(b).digest();
    const offset = h[h.length - 1] & 15;
    const n = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
    return String(n % (10 ** digits)).padStart(digits, "0");
}
export function verifyTotp(secretValue: string, code: string, now = Date.now(), lastUsedStep = -1): number | null {
    if (!/^\d{6}$/.test(code))
        return null;
    const step = Math.floor(now / 30000);
    for (const s of [step, step - 1, step + 1])
        if (s > lastUsedStep && s >= 0 && sameSecret(totp(secretValue, s), code))
            return s;
    return null;
}
export const newTotpSecret = () => base32(randomBytes(20));
