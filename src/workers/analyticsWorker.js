import { Worker } from "bullmq";
import redis from "../lib/redis.js";
import prisma from "../lib/prisma.js";

const QUEUE_NAME = "analytics";
const BATCH_SIZE = 500;
const FLUSH_INTERVAL = 5000;

const pendingEvents = [];
let flushing = false;
let flushTimer = null;

async function flushBatch(){
    if(flushing || pendingEvents.length === 0){
        return;
    }

    flushing = true;

    const batch = pendingEvents.splice(0,BATCH_SIZE);

    try {
        await prisma.usageEvent.createMany({
            data : batch.map(event => ({
                apiKeyId: event.data.apiKeyId,
                upstreamId: event.data.upstreamId,
                statusCode: event.data.statusCode,
                latencyMS: event.data.latencyMS,
                createdAt: new Date(event.data.createdAt)
            })),
        });

        for(const event of batch){
            event.resolve();
        }

        console.log(`inserted ${batch.length} analytics events`);
    } catch (error) {
        console.error("analytics events insertion failed",error);

        for(const event of batch){
            event.reject(error);
        }
    } finally {
        flushing = false;

        if(pendingEvents.length >= BATCH_SIZE){
            void flushBatch();
        } else if(pendingEvents.length > 0){
            scheduleFlush();
        }
    }
}

function scheduleFlush(){
    if(flushTimer !== null){
        return;
    }

    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushBatch();
    },FLUSH_INTERVAL);
}

async function processUsageEvent(job){
    return new Promise((resolve,reject) => {
        pendingEvents.push({
            data : job.data,
            resolve,
            reject
        });

        if(pendingEvents.length >= BATCH_SIZE){
            if(flushTimer !== null){
                clearTimeout(flushTimer);
                flushTimer = null;
            }

            void flushBatch();
        }
        else{
            scheduleFlush();
        }
    });
}

const worker = new Worker(
    QUEUE_NAME,
    processUsageEvent,
    {
        connection : redis,
        concurrency : BATCH_SIZE
    }
);

worker.on("completed", job => {
    // Job is completed only after its database insert succeeds.
});

worker.on("failed", (job, error) => {
    console.error(
        `Analytics job ${job?.id} failed:`,
        error.message
    );
});

worker.on("error", error => {
    console.error("Analytics worker error:", error);
});

console.log("analytics worker started");

async function shutdown(){
    console.log("Shutting down analytics worker...");
    try {
        await worker.close();

        if(flushTimer !== null){
            clearTimeout(flushTimer);
            flushTimer = null;
        }

        void flushBatch();

        await prisma.$disconnect();
        await redis.quit();

        console.log("Analytics worker stopped");
        process.exit(0);
    } catch (error) {
        console.error("analytics worker shutdown failed",error);
        process.exit(1);
    }
}

process.once("SIGINT",shutdown);
process.once("SIGTERM",shutdown);