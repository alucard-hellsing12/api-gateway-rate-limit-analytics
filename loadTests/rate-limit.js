import "dotenv/config";
import redis from "../src/lib/redis.js";

const gatewayUrl =
    process.env.GATEWAY_URL || "http://localhost:3000";

const upstreamId = process.env.TEST_UPSTREAM_ID;
const apiKey = process.env.TEST_API_KEY;
const apiKeyId = process.env.TEST_API_KEY_ID;

if (!upstreamId || !apiKey || !apiKeyId) {
    console.error(
        "Set TEST_UPSTREAM_ID, TEST_API_KEY and TEST_API_KEY_ID"
    );
    await redis.quit();
    process.exit(1);
}

const url =
    `${gatewayUrl}/proxy/${upstreamId}/products`;

try {
    // Start with a fresh token bucket.
    await redis.del(`rate-limit:${apiKeyId}`);

    console.log("Sending 100 concurrent requests...\n");

    const requests = Array.from({ length: 100 }, () =>
        fetch(url, {
            method: "GET",
            headers: {
                "X-API-Key": apiKey
            }
        })
    );

    const responses = await Promise.all(requests);

    const successful = responses.filter(
        response => response.status >= 200 &&
                    response.status < 300
    ).length;

    const rateLimited = responses.filter(
        response => response.status === 429
    ).length;

    const otherErrors = responses.filter(
        response => response.status !== 429 &&
                    (response.status < 200 ||
                     response.status >= 300)
    ).length;

    console.log("Total requests:", responses.length);
    console.log("Successful:", successful);
    console.log("Rate limited:", rateLimited);
    console.log("Other errors:", otherErrors);

} catch (error) {
    console.error("Load test failed:", error);
} finally {
    await redis.quit();
}