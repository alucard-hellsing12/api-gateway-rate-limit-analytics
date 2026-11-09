import {randomBytes,createHash} from "node:crypto";
import prisma from "../lib/prisma.js";
import { error } from "node:console";
import { invaliadteApiKeyCache } from "./apiKeyCache.js";

function hashApiKey(key){
    return createHash("sha256").update(key).digest("hex");
}

export async function createApiKey({userId,name,planId,upstreamId}){
    const upstream = await prisma.upstream.findFirst({
        where : { 
            id : upstreamId,
            userId
        },
    });

    if(!upstream) {
        return null;
    }

    const key = `gw_live_${randomBytes(32).toString("base64url")}`;
    const keyHash = hashApiKey(key);

    const apiKey = await prisma.apiKey.create({
    data: {
        name,
        prefix: key.slice(0, 16),
        keyHash,
        upstreamId: upstream.id,
        planId,
    },
    select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        plan: {
            select: {
            id: true,
            name: true,
            maxReq: true,
            },
        },
        },
    });

    return {...apiKey,key};
}

export async function listApiKeys({userId , upstreamId}){
    return prisma.apiKey.findMany({
        where : {
            upstreamId,
            upstream : {
                userId,
            }
        },
        select : {
            id: true,
            name: true,
            prefix:true,
            createdAt:true,
            revokedAt:true,
            plan : {
                select : {
                    name : true,
                    maxReq : true,
                }
            },
        },
        orderBy : {createdAt : "desc"},
    });
}

export async function revokeApiKey({keyId,userId}){
    const apiKey = await prisma.apiKey.findFirst({
        where: {
            id: keyId,
            revokedAt: null,
            upstream: {
                userId
            }
        },
        select: {
            keyHash: true
        }
    });

    if (!apiKey) return false;

    const result = await prisma.apiKey.updateMany({
        where: {
            id : keyId,
            upstream : {
                userId,
            },
            revokedAt : null 
        },
        data : {revokedAt: new Date()},
    });
    await invaliadteApiKeyCache(apiKey.keyHash);
    return result.count === 1;
}

export async function updateApiKeyPlan({keyId,userId,planName}){
    if(!["free","pro"].includes(planName)){
        throw new Error("INVALID_PLAN");
    }

    const plan = await prisma.plan.findUnique({
        where : {name : planName},
    });

    if(!plan){
        throw new Error("PLAN_NOT_FOUND");
    }

    const result = await prisma.apiKey.updateMany({
        where : {
            id : keyId,
            revokedAt : null,
            upstream : {
                userId,
            },
        },
        data : {
            planId : plan.id,
        },
    });

    if(result.count === 0){
        return null;
    }

    return prisma.apiKey.findUnique({
        where: { id: keyId },
        select: {
            id: true,
            name: true,
            prefix: true,
            upstreamId: true,
            keyHash: true,
            plan: {
                select: {
                    name: true,
                    maxReq: true
                }
            }
        }
    });
}