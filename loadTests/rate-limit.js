import "dotenv/config";
import autocannon from "autocannon";
import redis from "../src/lib/redis.js";

const gatewayUrl = process.env.GATEWAY_URL || "http://localhost:3000";
const upstreamId = process.env.TEST_UPSTREAM_ID;
const apiKey = process.env.TEST_API_KEY;
const apiKeyId = process.env.TEST_API_KEY_ID;
const path = process.env.TEST_PATH || "/products";
const scale = Number(process.env.PHASE_SCALE || 1);

const CAP_TOLERANCE = 3; // tokens of slack for timing jitter between machines

const PROFILES = {
    free: {
        limit: 60,
        phases: [
            { name: "1. Initial burst",             seconds: 10, rate: 150, connections: 20, expectDrain: true },
            { name: "2. Sustained, over limit 3/s", seconds: 40, rate: 3,   connections: 3  },
            { name: "3. Idle (bucket refills)",     seconds: 30, rate: 0,   connections: 0  },
            { name: "4. Recovery burst",            seconds: 10, rate: 150, connections: 20, expectDrain: true },
            { name: "5. Sustained, over limit 2/s", seconds: 30, rate: 2,   connections: 2  },
        ],
    },
    pro: {
        limit: 600,
        phases: [
            { name: "1. Steady 8/s",             seconds: 30, rate: 8,  connections: 4, underLimit: true },
            { name: "2. Ramp 18/s",              seconds: 30, rate: 18, connections: 6, underLimit: true },
            { name: "3. Short push 32/s",        seconds: 20, rate: 32, connections: 8, expectDrain: true },
            { name: "4. Cool down 4/s",          seconds: 15, rate: 4,  connections: 4 },
            { name: "5. Steady 8/s",             seconds: 25, rate: 8,  connections: 4, underLimit: true },
        ],
    },
};

const planName = (process.argv[2] || process.env.TEST_PLAN || "free").toLowerCase();
const profile = PROFILES[planName];
const PHASES = profile?.phases;

if (!profile) {
    console.error(`Unknown plan "${planName}". Use: ${Object.keys(PROFILES).join(" or ")}`);
    process.exit(1);
}

if (!upstreamId || !apiKey || !apiKeyId) {
    console.error("Set TEST_UPSTREAM_ID, TEST_API_KEY and TEST_API_KEY_ID");
    await redis.quit();
    process.exit(1);
}

if (!(scale > 0)) {
    console.error("PHASE_SCALE must be a positive number");
    await redis.quit();
    process.exit(1);
}

const url = `${gatewayUrl}/proxy/${upstreamId}${path}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const secs = (phase) => Math.max(1, Math.round(phase.seconds * scale));

/* ---------- shared observations (filled by autocannon's onResponse) ---------- */

let current = null;
let observedLimit = null;

const newStats = () => ({
    sent: 0,
    allowed: 0,
    limited: 0,
    other: {},
    missingRetryAfter: 0,
    maxRetryAfter: 0,
    minRemaining: Infinity,
});

// autocannon passes headers with the server's original casing, so normalise them.
function lowerCaseHeaders(raw) {
    const result = {};
    for (const [key, value] of Object.entries(raw || {})) {
        result[key.toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value);
    }
    return result;
}

function onResponse(status, body, context, rawHeaders) {
    const s = current;
    const headers = lowerCaseHeaders(rawHeaders);
    s.sent++;

    const limit = Number(headers["x-ratelimit-limit"]);
    if (Number.isFinite(limit) && limit > 0) observedLimit = limit;

    if (status === 429) {
        s.limited++;
        const retryAfter = Number(headers["retry-after"]);
        if (!Number.isFinite(retryAfter)) {
            s.missingRetryAfter++;
        } else {
            s.maxRetryAfter = Math.max(s.maxRetryAfter, retryAfter);
        }
    } else if (status >= 200 && status < 300) {
        s.allowed++;
        const remaining = Number(headers["x-ratelimit-remaining"]);
        if (Number.isFinite(remaining)) {
            s.minRemaining = Math.min(s.minRemaining, remaining);
        }
    } else {
        s.other[status] = (s.other[status] || 0) + 1;
    }
}

/* ---------- ideal token bucket, to compare against what we observed ---------- */

function makeModel(limit) {
    const refillPerSec = limit / 60;
    let tokens = limit;
    let last = 0;

    return {
        refillPerSec,
        // Spread n requests evenly over [t0, t1] and count how many the ideal bucket admits.
        run(n, t0, t1) {
            let allowed = 0;
            for (let i = 0; i < n; i++) {
                const t = t0 + ((i + 0.5) * (t1 - t0)) / n;
                tokens = Math.min(limit, tokens + refillPerSec * (t - last));
                last = t;
                if (tokens >= 1) {
                    tokens -= 1;
                    allowed++;
                }
            }
            return allowed;
        },
        advance(t) {
            tokens = Math.min(limit, tokens + refillPerSec * (t - last));
            last = t;
        },
    };
}

/* ---------- run ---------- */

const totalSeconds = PHASES.reduce((sum, p) => sum + secs(p), 0);

console.log(`Rate limit test (${planName} plan, ${profile.limit} req/min)`);
console.log(`Target : ${url}`);
console.log(`Length : ${totalSeconds}s across ${PHASES.length} phases (PHASE_SCALE=${scale})\n`);

// Preflight: make sure the key works and is on the plan this profile expects.
try {
    const probe = await fetch(url, { headers: { "X-API-Key": apiKey } });
    const probeLimit = Number(probe.headers.get("x-ratelimit-limit"));

    if (probe.status !== 200 && probe.status !== 429) {
        console.error(`Preflight failed: got HTTP ${probe.status}. Is the gateway running with mockUpstream.js, and is the key valid?`);
        await redis.quit();
        process.exit(1);
    }

    if (probeLimit !== profile.limit) {
        console.error(
            `Preflight failed: this key allows ${probeLimit || "an unknown number of"} req/min, ` +
            `but the ${planName} test needs ${profile.limit}. Use a ${planName}-plan key ` +
            `(PATCH /api-keys/:id/plan) or run the other profile.`
        );
        await redis.quit();
        process.exit(1);
    }
} catch (error) {
    console.error(`Preflight failed: cannot reach ${url} (${error.message})`);
    await redis.quit();
    process.exit(1);
}

await redis.del(`rate-limit:${apiKeyId}`); // start from a full bucket

const results = [];
const runStart = performance.now();

for (const phase of PHASES) {
    const duration = secs(phase);
    const stats = newStats();
    current = stats;

    const phaseStart = (performance.now() - runStart) / 1000;
    console.log(
        phase.rate > 0
            ? `> ${phase.name}: ${duration}s at ${phase.rate} req/s`
            : `> ${phase.name}: ${duration}s idle`
    );

    let latency = null;

    if (phase.rate > 0) {
        const result = await autocannon({
            url,
            connections: phase.connections,
            duration,
            overallRate: phase.rate,
            timeout: 10,
            headers: { "X-API-Key": apiKey },
            requests: [{ method: "GET", onResponse }],
        });

        latency = { p50: result.latency.p50, p99: result.latency.p99 };
    } else {
        await sleep(duration * 1000);
    }

    const phaseEnd = (performance.now() - runStart) / 1000;
    results.push({ phase, stats, latency, phaseStart, phaseEnd });
}

/* ---------- analyse ---------- */

const limit = observedLimit ?? profile.limit;
const model = makeModel(limit);
const failures = [];
const warnings = [];

if (observedLimit === null) {
    failures.push("no X-RateLimit-Limit header seen; are requests reaching the gateway?");
} else if (observedLimit !== profile.limit) {
    failures.push(`the key's limit changed to ${observedLimit}/min during the run (expected ${profile.limit})`);
}

let cumulativeAllowed = 0;
let totalSent = 0;
let totalLimited = 0;

const pad = (value, width) => String(value).padEnd(width);
const num = (value, width) => String(value).padStart(width);

console.log("\nResults");
console.log(
    pad("Phase", 32) + num("Sent", 7) + num("Allowed", 9) + num("Expected", 10) +
    num("429", 7) + num("p50ms", 8) + num("p99ms", 8) + num("MaxRetry", 10)
);
console.log("-".repeat(91));

for (const { phase, stats, latency, phaseStart, phaseEnd } of results) {
    let expected;
    if (stats.sent > 0) {
        expected = model.run(stats.sent, phaseStart, phaseEnd);
    } else {
        model.advance(phaseEnd);
        expected = 0;
    }
    model.advance(phaseEnd);

    cumulativeAllowed += stats.allowed;
    totalSent += stats.sent;
    totalLimited += stats.limited;

    console.log(
        pad(phase.name, 32) + num(stats.sent, 7) + num(stats.allowed, 9) + num(expected, 10) +
        num(stats.limited, 7) + num(latency ? latency.p50 : "-", 8) +
        num(latency ? latency.p99 : "-", 8) + num(stats.maxRetryAfter ? `${stats.maxRetryAfter}s` : "-", 10)
    );

    // Hard check: the bucket can never have admitted more than capacity + refill so far.
    const cap = limit + model.refillPerSec * phaseEnd + CAP_TOLERANCE;
    if (cumulativeAllowed > cap) {
        failures.push(
            `${phase.name}: ${cumulativeAllowed} allowed so far but at most ` +
            `${Math.floor(cap)} are possible (limiter over-admitted)`
        );
    }

    if (stats.missingRetryAfter > 0) {
        failures.push(`${phase.name}: ${stats.missingRetryAfter} 429 responses had no Retry-After header`);
    }

    if (phase.underLimit && stats.limited > 2) {
        failures.push(
            `${phase.name}: ${stats.limited} requests were rejected although traffic stayed ` +
            `below the plan limit`
        );
    }

    const otherCount = Object.values(stats.other).reduce((a, b) => a + b, 0);
    if (otherCount > 0) {
        failures.push(
            `${phase.name}: unexpected statuses ${JSON.stringify(stats.other)} ` +
            `(is mockUpstream.js running, and is the key valid?)`
        );
    }

    // Soft check against the ideal model.
    const tolerance = Math.max(5, Math.round(expected * 0.1));
    if (stats.sent > 0 && Math.abs(stats.allowed - expected) > tolerance) {
        warnings.push(
            `${phase.name}: allowed ${stats.allowed}, ideal model says ~${expected} (+/-${tolerance})`
        );
    }
}

console.log("-".repeat(91));

const elapsed = results[results.length - 1].phaseEnd;
const maxPossible = Math.floor(limit + model.refillPerSec * elapsed);

console.log(`Total sent: ${totalSent}   allowed: ${cumulativeAllowed}   rate limited: ${totalLimited}`);
console.log(`Upper bound for ${elapsed.toFixed(0)}s: ${maxPossible} allowed (capacity ${limit} + refill ${model.refillPerSec}/s)`);

if (totalSent > 0) {
    console.log(`Rejected share: ${((totalLimited / totalSent) * 100).toFixed(1)}%`);
}

if (totalLimited === 0) {
    failures.push("no request was ever rate limited; the limiter did not engage");
}

for (const { phase, stats } of results) {
    if (phase.expectDrain && stats.minRemaining > 1) {
        warnings.push(`X-RateLimit-Remaining never dropped to about 0 in "${phase.name}"`);
    }
}

console.log("");
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const failure of failures) console.log(`FAIL  ${failure}`);

if (failures.length === 0) {
    console.log(warnings.length === 0 ? "PASS  rate limiter behaved as expected" : "PASS  with warnings");
} else {
    process.exitCode = 1;
}

console.log("\nTip: wait ~5s for the analytics worker, then check GET /stats/overview and /stats/latency.");

await redis.quit();