import prisma from "../lib/prisma.js";
import z from "zod";

const upstreamSchema = z.object({
    name : z.string().trim().min(1).max(100),
    baseUrl : z.url().max(2048)
});

export async function createUpstream({userId,data}){
    const input = upstreamSchema.parse(data);
    const url = new URL(input.baseUrl)
    if(!["http:","https:"].includes(url.protocol) || url.password || url.username){
        throw new Error("INVALID_UPSTREAM_URL");
    }

    return prisma.upstream.create({
        data : {
            name: input.name,
            userId,
            baseUrl: url.toString().replace(/\/$/, ""),
        },
        select : {
            id : true,
            name : true,
            baseUrl: true,
            createdAt : true,
        }
    });
}

export async function listUpstream(userId){
    return prisma.upstream.findMany({
        where : {
            userId,
        },
        select : {
            id: true,
            name: true,
            baseUrl: true,
            createdAt: true,
            _count: {
                select: {
                    apiKey: true,
                },
            },
        },
        orderBy : {createdAt : "desc"},
    });
}

export async function deleteUpstream({userId,upstreamId}){
    const upstream = await prisma.upstream.findFirst({
        where : {
            userId,
            id : upstreamId,
        },
        select: {
            id : true,
            _count: {
                select : {
                    apiKey : {
                        where : {
                            revokedAt : null
                        }
                    }
                },
            },
        },
    });

    if(!upstream){
        return { status : "not_found"};
    }

    if(upstream._count.apiKey > 0){
        return {status : "has_api_keys"};
    }

    await prisma.upstream.delete({
        where: { id: upstream.id },
    });

    return { status: "deleted" };
}

export async function getUpstreamById(upstreamId){
    return prisma.upstream.findUnique({
        where : {id: upstreamId},
        select: {
            id: true,
            name: true,
            baseUrl: true,
        },
    });
}