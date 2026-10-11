import {randomBytes} from "node:crypto";
// These values are printed locally only. Store them in a secret manager; never commit them.
console.log(`DATA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`SEARCH_HMAC_KEY=${randomBytes(32).toString("base64")}`);
console.log(`FILE_SCAN_SECRET=${randomBytes(40).toString("base64url")}`);
