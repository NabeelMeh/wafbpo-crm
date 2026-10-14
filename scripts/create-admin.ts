import { randomUUID } from "node:crypto";
import { collections, transaction, client, actor, type UserDoc } from "../src/lib/db.ts";
import { hashPassword } from "../src/lib/crypto.ts";
import { passwordPolicy } from "../src/lib/domain/validation.ts";
import { userSearchTokens } from "../src/lib/search.ts";
import { audit } from "../src/lib/audit.ts";
async function main() {
    const username = process.env.ADMIN_USERNAME?.trim().toLowerCase(), name = process.env.ADMIN_NAME?.trim(), password = process.env.ADMIN_PASSWORD;
    if (!username || !/^[a-z0-9._-]{3,60}$/.test(username) || !name || !password)
        throw new Error("Set ADMIN_USERNAME, ADMIN_NAME and ADMIN_PASSWORD in .env.local first.");
    passwordPolicy(password);
    const c = await collections(), now = new Date().toISOString();
    const user: UserDoc = { _id: randomUUID(), name, username, employeeId: "CNB-ADMIN-001", employeeIdNormalized: "cnb-admin-001", designation: "System Administrator", enrollmentStatus: "ENROLLED", deletionGranted: false, searchTokens: userSearchTokens(name, username, "CNB-ADMIN-001"), role: "SUPER_ADMIN", memberships: [], accountStatus: "ACTIVE", passwordHash: await hashPassword(password), sessionVersion: 0, mustChangePassword: false, mfaEnabled: false, createdAt: now, updatedAt: now };
    await transaction(async (session) => {
        await c.duplicateGuards.updateOne({ _id: "administration:superadmin-lock" }, { $inc: { version: 1 } }, { upsert: true, session });
        if (await c.users.findOne({ role: { $in: ["SUPER_ADMIN", "ADMIN"] } }, { session }))
            throw new Error("A Super Admin already exists. This one-time bootstrap refuses to create another.");
        await c.users.insertOne(user, { session });
        await audit(actor(user), "BOOTSTRAP_SUPER_ADMIN", { userId: user._id }, undefined, session);
    });
    console.log(`Created Super Admin: ${username}. No demo users or patient records were inserted.`);
    console.log("Remove ADMIN_PASSWORD from local settings after login; enroll MFA before production use.");
}
try {
    await main();
}
catch (error) {
    console.error(error instanceof Error && error.name === "Error" ? error.message : "Administrator creation failed. Check configuration and database permissions.");
    process.exitCode = 1;
}
finally {
    if (globalThis.wafMongoPromise)
        await (await client()).close();
}
