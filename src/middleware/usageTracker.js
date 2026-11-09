import { recordUsage } from "../services/analyticsService.js";

export function usageTracker(req,res,next) {
    const start = process.hrtime.bigint();

    res.once("finish", () => {
        const end = process.hrtime.bigint();
        const latencyMS = Number((end - start) / 1_000_000n);
        const createdAt = new Date().toISOString();

        recordUsage({
            apiKeyId: req.apiKey.id,
            upstreamId : req.apiKey.upstreamId,
            statusCode : res.statusCode,
            latencyMS,
            createdAt
        });
    });

    next();
}