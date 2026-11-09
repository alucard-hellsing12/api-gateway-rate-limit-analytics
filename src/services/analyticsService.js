import { analyticsQueue } from "../queues/analyticsQueue.js";

export function recordUsage(event){
    analyticsQueue.add("usage-event",event,{
        attempts: 5,
        backoff: {
            type: "exponential",
            delay: 1000
        },
        removeOnComplete : true,
        removeOnFail : 1000
    }).catch(error => {
        console.error("failed to enqueue analytics event: ",error);
    });
}
