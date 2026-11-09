import "dotenv/config";
import autocannon from "autocannon";

const gatewayUrl =
    process.env.GATEWAY_URL || "http://localhost:3000";

const upstreamId = process.env.TEST_UPSTREAM_ID;
const apiKey = process.env.TEST_API_KEY;

if (!upstreamId || !apiKey) {
    console.error(
        "Set TEST_UPSTREAM_ID and TEST_API_KEY in your .env file"
    );
    process.exit(1);
}

const url =
    `${gatewayUrl}/proxy/${upstreamId}/products`;

console.log("\nStarting API Gateway benchmark...");
console.log("Target:", url);
console.log("Cache enabled:", process.env.API_KEY_CACHE_ENABLED);
console.log("Connections: 10");
console.log("Duration: 30 seconds\n");

const instance = autocannon({
    url,
    method: "GET",
    connections: 10,
    duration: 30,
    headers: {
        "X-API-Key": apiKey
    }
});

autocannon.track(instance, {
    renderProgressBar: true,
    renderResultsTable: true,
    renderLatencyTable: true
});

instance.on("done", result => {
    console.log("\n========== BENCHMARK SUMMARY ==========");

    console.log("Requests per second:", result.requests.average);
    console.log("Throughput (bytes/sec):", result.throughput.average);

    console.log("\nLatency (ms)");
    console.log("Average:", result.latency.average);
    console.log("p50:", result.latency.p50);
    console.log("p97:", result.latency.p97);
    console.log("p99:", result.latency.p99);

    console.log("\nErrors:", result.errors);
    console.log("Timeouts:", result.timeouts);
    console.log("Non-2xx responses:", result.non2xx);

    console.log("=======================================\n");
});