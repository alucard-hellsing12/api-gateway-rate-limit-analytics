import redis from "../lib/redis.js";
import {readFileSync} from "node:fs"

const tokenBucket = readFileSync(
    new URL("../scripts/token_bucket.lua",import.meta.url),
    "utf-8"
);

export async function rateLimiter(req,res,next){
    try {
        const limit = req.apiKey?.plan?.maxReq;

        if(!Number.isInteger(limit) || limit <= 0){
            return res.status(500).json({
                error : "invalid rate limit configuration"
            });
        }

        const redisKey = `rate-limit:${req.apiKey.id}`;
        const [allowed, remaining, retryAfterMs] =
            await redis.eval(
                tokenBucket,
                1,
                redisKey,
                limit
            );
        
        res.setHeader("X-RateLimit-Limit", limit);
        res.setHeader("X-RateLimit-Remaining", remaining);

        if (Number(allowed) === 0) {
            const retryAfter = Math.ceil(
                Number(retryAfterMs) / 1000
            );

            res.setHeader("Retry-After", retryAfter);

            return res.status(429).json({
                error: "Rate limit exceeded",
                limit,
                retryAfter
            });
        }

        next();
    } catch (error) {
        console.error("Rate limiter error:", error);

        return res.status(503).json({
            error: "Rate limiting service unavailable"
        });
    }
}
