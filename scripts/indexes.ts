import { ensureIndexes, client } from "../src/lib/db.ts";
try {
    await ensureIndexes();
    console.log("MongoDB indexes created or verified. No patient records were changed.");
}
catch (error) {
    console.error("Index migration failed. Verify migration permissions, MongoDB connectivity and existing unique-key collisions.");
    console.error(error instanceof Error ? error.name : "UnknownError");
    process.exitCode = 1;
}
finally {
    if (globalThis.wafMongoPromise)
        await (await client()).close();
}
