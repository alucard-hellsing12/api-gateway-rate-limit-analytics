import prisma from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.ts";

function buildFilters({
    userId,
    upstreamId,
    apiKeyId,
    from,
    to
}) {
    const filters = [
        Prisma.sql`u."userId" = ${userId}`
    ];

    if (upstreamId) {
        filters.push(
            Prisma.sql`ue."upstreamId" = ${upstreamId}`
        );
    }

    if (apiKeyId) {
        filters.push(
            Prisma.sql`ue."apiKeyId" = ${apiKeyId}`
        );
    }

    if (from) {
        filters.push(
            Prisma.sql`ue."createdAt" >= ${from}`
        );
    }

    if (to) {
        filters.push(
            Prisma.sql`ue."createdAt" <= ${to}`
        );
    }

    return Prisma.join(filters, " AND ");
}

function parseFilters(query, userId) {
    const now = new Date();

    const to = query.to
        ? new Date(query.to)
        : now;

    const from = query.from
        ? new Date(query.from)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);

    if (
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        from > to
    ) {
        throw new Error("INVALID_DATE_RANGE");
    }

    return {
        userId,
        upstreamId: query.upstreamId || null,
        apiKeyId: query.apiKeyId || null,
        from,
        to
    };
}

export async function getOverview(query, userId) {
    const filters = buildFilters(
        parseFilters(query, userId)
    );

    const [result] = await prisma.$queryRaw(
        Prisma.sql`
            SELECT
                COUNT(*)::int AS "totalRequests",

                COUNT(*) FILTER (
                    WHERE ue."statusCode" >= 400
                )::int AS "failedRequests",

                COALESCE(
                    ROUND(AVG(ue."latencyMS")::numeric, 2),
                    0
                ) AS "averageLatencyMs"

            FROM "UsageEvent" ue

            JOIN "Upstream" u
                ON u.id = ue."upstreamId"

            WHERE ${filters}
        `
    );

    const total = result.totalRequests;
    const failed = result.failedRequests;

    return {
        totalRequests: total,
        failedRequests: failed,
        successfulRequests: total - failed,
        errorRate: total === 0
            ? 0
            : Number(((failed / total) * 100).toFixed(2)),
        averageLatencyMs: Number(result.averageLatencyMs)
    };
}

export async function getRequestsPerMinute(query, userId) {
    const filters = buildFilters(
        parseFilters(query, userId)
    );

    return prisma.$queryRaw(
        Prisma.sql`
            SELECT
                date_trunc(
                    'minute',
                    ue."createdAt"
                ) AS minute,

                COUNT(*)::int AS requests

            FROM "UsageEvent" ue

            JOIN "Upstream" u
                ON u.id = ue."upstreamId"

            WHERE ${filters}

            GROUP BY minute
            ORDER BY minute ASC
        `
    );
}

export async function getErrorRate(query, userId) {
    const filters = buildFilters(
        parseFilters(query, userId)
    );

    const [result] = await prisma.$queryRaw(
        Prisma.sql`
            SELECT
                COUNT(*)::int AS "totalRequests",

                COUNT(*) FILTER (
                    WHERE ue."statusCode" >= 400
                )::int AS "failedRequests"

            FROM "UsageEvent" ue

            JOIN "Upstream" u
                ON u.id = ue."upstreamId"

            WHERE ${filters}
        `
    );

    const total = result.totalRequests;
    const failed = result.failedRequests;

    return {
        totalRequests: total,
        failedRequests: failed,
        errorRate: total === 0
            ? 0
            : Number(((failed / total) * 100).toFixed(2))
    };
}

export async function getLatency(query, userId) {
    const filters = buildFilters(
        parseFilters(query, userId)
    );

    const [result] = await prisma.$queryRaw(
        Prisma.sql`
            SELECT
                COALESCE(
                    ROUND(AVG(ue."latencyMS")::numeric, 2),
                    0
                ) AS "averageLatencyMs",

                COALESCE(
                    percentile_cont(0.50)
                    WITHIN GROUP (
                        ORDER BY ue."latencyMS"
                    ),
                    0
                ) AS "p50",

                COALESCE(
                    percentile_cont(0.95)
                    WITHIN GROUP (
                        ORDER BY ue."latencyMS"
                    ),
                    0
                ) AS "p95",

                COALESCE(
                    percentile_cont(0.99)
                    WITHIN GROUP (
                        ORDER BY ue."latencyMS"
                    ),
                    0
                ) AS "p99"

            FROM "UsageEvent" ue

            JOIN "Upstream" u
                ON u.id = ue."upstreamId"

            WHERE ${filters}
        `
    );

    return {
        averageLatencyMs: Number(result.averageLatencyMs),
        p50: Number(result.p50),
        p95: Number(result.p95),
        p99: Number(result.p99)
    };
}